/**
 * Roda o motor de matchup contra confrontos conhecidos.
 *   npm run matchup:smoke
 *
 * Os confrontos escolhidos têm resposta conhecida por qualquer jogador — é
 * assim que dá para ver se o motor está calibrado ou só produzindo números.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { getCatalog } from "../src/db/queries/catalog";
import { analyzeMatchup, verdictLabel, type MatchupCatalog, type LaneState } from "../src/engine/matchup";
import { buildMatchupDiagnosis } from "../src/engine/prompt-builder";

const CASES: { lane: string; expected: string; state: LaneState }[] = [
  {
    lane: "Teemo x Darius (top)",
    expected: "favorável ao Teemo: alcance e poke contra all-in sem escape",
    state: { selfChampionId: "Teemo", enemyChampionId: "Darius", allyJungleId: null, enemyJungleId: "JarvanIV" },
  },
  {
    lane: "Darius x Teemo (top)",
    expected: "desfavorável ao Darius",
    state: { selfChampionId: "Darius", enemyChampionId: "Teemo", allyJungleId: null, enemyJungleId: "Ivern" },
  },
  {
    lane: "Nasus x Renekton (top)",
    expected: "desfavorável ao Nasus: escalonamento contra early game",
    state: { selfChampionId: "Nasus", enemyChampionId: "Renekton", allyJungleId: null, enemyJungleId: "Elise" },
  },
  {
    lane: "Malphite x Yasuo (top)",
    expected: "favorável ao Malphite",
    state: { selfChampionId: "Malphite", enemyChampionId: "Yasuo", allyJungleId: null, enemyJungleId: "Amumu" },
  },
  {
    lane: "Lux x Zed (mid)",
    expected: "desfavorável à Lux: imóvel contra dash",
    state: { selfChampionId: "Lux", enemyChampionId: "Zed", allyJungleId: null, enemyJungleId: "LeeSin" },
  },
];

async function main() {
  const payload = await getCatalog();
  if (!payload) throw new Error("Banco vazio: rode npm run sync");

  const catalog: MatchupCatalog = {
    champions: new Map(payload.champions.map((c) => [c.id, c])),
    tagRules: payload.matchupRules,
    overrides: payload.matchupOverrides,
  };

  for (const testCase of CASES) {
    const a = analyzeMatchup(testCase.state, catalog);
    console.log(`\n${"=".repeat(72)}`);
    console.log(`${testCase.lane}`);
    console.log(`esperado: ${testCase.expected}`);
    console.log(
      `resultado: ${verdictLabel(a.verdict)} (${a.score > 0 ? "+" : ""}${a.score}) · gank ${a.gankRisk.level}`,
    );
    for (const c of a.contributions.slice(0, 4)) {
      console.log(`   ${c.advantage > 0 ? "+" : ""}${Math.round(c.advantage * 10) / 10}  ${c.label}`);
    }
    console.log(`   plano: ${a.plan.map((p) => p.title).join(" → ")}`);
  }

  const sample = analyzeMatchup(CASES[0].state, catalog);
  console.log(`\n${"=".repeat(72)}\nDiagnóstico de Rota (caso 1)\n${"=".repeat(72)}`);
  console.log(buildMatchupDiagnosis(sample, payload.patch));

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
