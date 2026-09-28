/**
 * Estatística ponta a ponta sem chave da Riot:
 *   1. grava a partida de scripts/fixtures, agrega e APAGA em seguida;
 *   2. roda o assistente de seleção com uma estatística em memória.
 *   npm run stats:smoke
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { riotMatches } from "../src/db/schema";
import { getCatalog } from "../src/db/queries/catalog";
import { getStatsPayload, storeMatch } from "../src/db/queries/matches";
import { suggestPicks } from "../src/engine/draft";
import { EMPTY_TEAM } from "../src/engine/match";
import { buildStatsIndex, type StatsPayload } from "../src/engine/stats";
import type { MatchDto } from "../src/lib/riot/types";

const expect = (cond: boolean, what: string) => {
  if (!cond) throw new Error(`FALHOU: ${what}`);
};

async function main() {
  const payload = await getCatalog();
  if (!payload) throw new Error("Banco vazio: rode npm run sync");

  // 1) gravar → agregar → apagar
  const match = JSON.parse(readFileSync("scripts/fixtures/match-v5.json", "utf8")) as MatchDto;
  const id = match.metadata.matchId;
  const hadRealData = (await getStatsPayload(payload.patch)) !== null;
  try {
    await storeMatch(match);
    await storeMatch(match); // idempotente
    const stats = await getStatsPayload(payload.patch);
    if (!hadRealData) {
      expect(stats?.matches === 1, "uma partida agregada, sem duplicar");
      const ahri = stats!.roleStats.find((r) => r.championId === "Ahri");
      expect(ahri?.role === "MID" && ahri.games === 1 && ahri.wins === 0, "Ahri no meio, 1 derrota");
      expect(stats!.bans.some((b) => b.championId === "Yasuo"), "ban numérico virou id do Data Dragon");
      console.log(`agregação ok: ${stats!.roleStats.length} linhas de rota, bans ${stats!.bans.map((b) => b.championId).join(", ")}`);
    } else {
      console.log("banco já tem partidas reais: pulando as contagens exatas");
    }
  } finally {
    await db.delete(riotMatches).where(eq(riotMatches.id, id));
  }
  const left = await db.select({ id: riotMatches.id }).from(riotMatches).where(eq(riotMatches.id, id));
  expect(left.length === 0, "partida de teste apagada (participantes em cascata)");

  // 2) draft com estatística: Syndra tem dados fortes contra Zed, Ahri não
  const champions = new Map(payload.champions.map((c) => [c.id, c]));
  const fake: StatsPayload = {
    patch: "16.17",
    matches: 5000,
    roleStats: [
      { championId: "Syndra", role: "MID", games: 900, wins: 486 },
      { championId: "Ahri", role: "MID", games: 1200, wins: 588 },
    ],
    matchups: [{ championId: "Syndra", opponentId: "Zed", role: "MID", games: 80, wins: 50 }],
    bans: [],
  };
  const base = { champions, tagRules: payload.matchupRules, overrides: payload.matchupOverrides };
  const board = { myRole: "MID" as const, allies: { ...EMPTY_TEAM }, enemies: { ...EMPTY_TEAM, MID: "Zed" }, bans: [] };

  const rank = (withStats: boolean) =>
    suggestPicks({
      role: "MID",
      board,
      catalog: withStats ? { ...base, stats: buildStatsIndex(fake) } : base,
      limit: 999,
    });
  const before = rank(false);
  const after = rank(true);
  const pos = (list: typeof before, id: string) => list.findIndex((s) => s.champion.id === id) + 1;
  const syndra = after.find((s) => s.champion.id === "Syndra")!;
  console.log(`\nSyndra contra Zed: posição ${pos(before, "Syndra")} → ${pos(after, "Syndra")}`);
  console.log(`  ${syndra.reasons.join(" | ")}`);
  console.log(`Ahri contra Zed: posição ${pos(before, "Ahri")} → ${pos(after, "Ahri")}`);
  expect(pos(after, "Syndra") < pos(before, "Syndra"), "dado real favorável sobe a Syndra");
  expect(pos(after, "Ahri") >= pos(before, "Ahri"), "49% no patch não sobe a Ahri");
  expect(syndra.reasons[0].includes("partidas reais"), "o motivo cita a amostra real");

  console.log("\nok — todas as verificações passaram");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
