/**
 * Assistente de seleção contra o banco real.
 *   npm run draft:smoke
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { getCatalog } from "../src/db/queries/catalog";
import {
  suggestPicks,
  estimateWinChance,
  strongAndWeak,
  type DraftBoard,
} from "../src/engine/draft";
import type { MatchupCatalog } from "../src/engine/matchup";
import { EMPTY_TEAM, ROLE_LABEL, type Role } from "../src/engine/match";

async function main() {
  const payload = await getCatalog();
  if (!payload) throw new Error("Banco vazio: rode npm run sync");

  const catalog: MatchupCatalog = {
    champions: new Map(payload.champions.map((c) => [c.id, c])),
    tagRules: payload.matchupRules,
    overrides: payload.matchupOverrides,
  };

  const byRole: Record<string, number> = {};
  for (const c of payload.champions) for (const p of c.positions) byRole[p] = (byRole[p] ?? 0) + 1;
  console.log("campeões por rota:", JSON.stringify(byRole));

  // 1) quadro vazio: quem é seguro de pegar em cada rota
  for (const role of ["TOP", "MID", "ADC", "SUPPORT"] as Role[]) {
    const t0 = Date.now();
    const board: DraftBoard = {
      myRole: role,
      allies: { ...EMPTY_TEAM },
      enemies: { ...EMPTY_TEAM },
      bans: [],
    };
    const picks = suggestPicks({ role, board, catalog, limit: 5 });
    console.log(`\n${ROLE_LABEL[role]} — quadro vazio (${Date.now() - t0}ms)`);
    for (const p of picks) console.log(`  ${p.champion.name.padEnd(14)} ${p.score}  · ${p.reasons[0]}`);
  }

  // 2) cenário do usuário: sou atirador, o suporte inimigo é Leona
  console.log(`\n${"=".repeat(72)}`);
  console.log("Sou ATIRADOR. O suporte inimigo escolheu Leona. Que suporte meu time deve pegar?");
  const board: DraftBoard = {
    myRole: "ADC",
    allies: { ...EMPTY_TEAM },
    enemies: { ...EMPTY_TEAM, SUPPORT: "Leona" },
    bans: [],
  };
  for (const p of suggestPicks({ role: "SUPPORT", board, catalog, limit: 5 })) {
    console.log(`  ${p.champion.name.padEnd(14)} ${p.score}  · ${p.reasons.join(" | ")}`);
  }

  // 3) com o suporte aliado escolhido, qual atirador eu pego
  console.log("\nMeu time pegou Lulu de suporte. Que atirador eu pego?");
  const board2: DraftBoard = {
    ...board,
    allies: { ...EMPTY_TEAM, SUPPORT: "Lulu" },
    enemies: { ...EMPTY_TEAM, SUPPORT: "Leona", ADC: "Caitlyn" },
  };
  for (const p of suggestPicks({ role: "ADC", board: board2, catalog, limit: 5 })) {
    console.log(`  ${p.champion.name.padEnd(14)} ${p.score}  · ${p.reasons.join(" | ")}`);
  }

  // 4) chances com times completos
  const full: DraftBoard = {
    myRole: "ADC",
    allies: { TOP: "Malphite", JUNGLE: "JarvanIV", MID: "Orianna", ADC: "Jinx", SUPPORT: "Lulu" },
    enemies: { TOP: "Darius", JUNGLE: "LeeSin", MID: "Zed", ADC: "Caitlyn", SUPPORT: "Leona" },
    bans: [],
  };
  const estimate = estimateWinChance(full, catalog);
  console.log(`\n${"=".repeat(72)}`);
  console.log(`Chances: ${estimate.chance}% — ${estimate.label} (confiança ${estimate.confidence})`);
  for (const f of estimate.factors) {
    console.log(`  ${f.delta > 0 ? "+" : ""}${Math.round(f.delta * 10) / 10}  ${f.label}`);
  }

  // 5) forte e fraco contra: 3 de cada lado, sempre da mesma rota
  console.log(`
${"=".repeat(72)}`);
  const expect = (cond: boolean, what: string) => {
    if (!cond) throw new Error(`FALHOU: ${what}`);
  };
  for (const [id, role] of [["Darius", "TOP"], ["Zed", "MID"], ["Caitlyn", "ADC"]] as const) {
    const { strong, weak } = strongAndWeak(id, role, catalog);
    console.log(`${id}: forte contra ${strong.map((m) => `${m.champion.name} ${m.score}`).join(", ")}`);
    console.log(`${" ".repeat(id.length)}  fraco contra ${weak.map((m) => `${m.champion.name} ${m.score}`).join(", ")}`);
    expect(strong.length === 3 && weak.length === 3, `${id}: 3 de cada lado`);
    expect(strong[2].score >= weak[0].score, `${id}: o pior forte não perde para o melhor fraco`);
    expect(
      [...strong, ...weak].every((m) => m.champion.positions.includes(role) && m.champion.id !== id),
      `${id}: só oponentes da mesma rota, sem ele mesmo`,
    );
  }
  // o confronto curado à mão (a cegueira do Teemo) tem de aparecer
  expect(
    strongAndWeak("Darius", "TOP", catalog).weak.some((m) => m.champion.id === "Teemo"),
    "Teemo entre os piores do Darius",
  );
  console.log("ok — forte e fraco contra");

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
