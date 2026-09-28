/**
 * Revisão pós-jogo contra o banco real e uma partida gravada em
 * scripts/fixtures (formato Match-V5) — não precisa de chave da Riot.
 *   npm run review:smoke
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { readFileSync } from "node:fs";
import { getCatalog } from "../src/db/queries/catalog";
import { buildReview } from "../src/engine/review";
import type { MatchDto, TimelineDto } from "../src/lib/riot/types";

async function main() {
  const payload = await getCatalog();
  if (!payload) throw new Error("Banco vazio: rode npm run sync");
  const champions = new Map(payload.champions.map((c) => [c.id, c]));
  const catalog = { items: new Map(payload.items.map((i) => [i.id, i])), champions, rules: payload.rules };
  const matchupCatalog = { champions, tagRules: payload.matchupRules, overrides: payload.matchupOverrides };

  const match = JSON.parse(readFileSync("scripts/fixtures/match-v5.json", "utf8")) as MatchDto;
  const timeline = JSON.parse(readFileSync("scripts/fixtures/timeline-v5.json", "utf8")) as TimelineDto;

  const t0 = Date.now();
  const review = buildReview({ match, timeline, puuid: "puuid-3", catalog, matchupCatalog });
  if (!review) throw new Error("revisão não montou");
  console.log(`revisão em ${Date.now() - t0}ms — ${review.me.championName} ${review.me.role}`);

  console.log(`\nROTA: ${review.lane.text}`);
  console.log(`  ouro @10 ${review.lane.goldDiff10} · @14 ${review.lane.goldDiff14} · cs @14 ${review.lane.csDiff14}`);

  console.log("\nCOMPRAS");
  for (const p of review.purchases)
    console.log(`  ${String(p.minute).padStart(2)}' ${p.item.name.padEnd(28)} ${p.verdict.padEnd(9)} ${p.note}`);

  console.log("\nMORTES");
  for (const d of review.deaths)
    console.log(`  ${String(d.minute).padStart(2)}:${String(d.second).padStart(2, "0")} ${d.kind.padEnd(11)} ${d.text}`);

  console.log("\nLIÇÕES");
  review.lessons.forEach((l, i) => console.log(`  ${i + 1}. ${l.title}\n     ${l.detail}`));

  const expect = (cond: boolean, what: string) => {
    if (!cond) throw new Error(`FALHOU: ${what}`);
  };
  const kinds = review.deaths.map((d) => d.kind).join(",");
  expect(kinds === "GANK,GANK,ISOLADO,DUELO", `mortes classificadas (veio ${kinds})`);
  expect(review.lane.opponent?.championName === "Zed", "oponente de rota é o Zed");
  expect(review.lane.outcome === "PERDEU", "rota perdida pelo ouro aos 14");
  expect(review.purchases.length === 4, "4 lendários comprados avaliados");
  expect(review.lessons[0].title.includes("gank"), "lição principal: ganks");
  expect(review.teamGold.length === 32, "curva de ouro por minuto");
  console.log("\nok — todas as verificações passaram");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
