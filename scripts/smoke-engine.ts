/**
 * Roda o motor de itemização contra cenários reais do banco.
 *   npm run engine:smoke
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { getCatalog } from "../src/db/queries/catalog";
import { analyze, type Catalog } from "../src/engine/itemization";
import type { MatchState } from "../src/engine/types";

const SCENARIOS: { name: string; state: MatchState }[] = [
  {
    name: "ADC crítico contra Mundo full tank",
    state: {
      self: { championId: "Jinx", level: 13, itemIds: [3031 /* Infinity Edge */], gold: 1400 },
      threat: {
        championId: "DrMundo",
        level: 13,
        itemIds: [3084 /* Heartsteel */, 3075 /* Thornmail */, 3143 /* Randuin's */],
      },
      enemyTeam: [
        { championId: "Soraka", level: 13, itemIds: [] },
        { championId: "Nasus", level: 13, itemIds: [] },
      ],
    },
  },
  {
    name: "Mago contra assassino AD com lifesteal",
    state: {
      self: { championId: "Lux", level: 11, itemIds: [6655 /* Ludens */], gold: 3200 },
      threat: { championId: "Zed", level: 11, itemIds: [3153 /* BORK */, 3072 /* Bloodthirster */] },
      enemyTeam: [
        { championId: "Vladimir", level: 11, itemIds: [] },
        { championId: "Malphite", level: 11, itemIds: [] },
      ],
    },
  },
  {
    name: "Bruiser contra mago burst, sem informação de itens",
    state: {
      self: { championId: "Darius", level: 9, itemIds: [], gold: 900 },
      threat: { championId: "Syndra", level: 9, itemIds: [] },
      enemyTeam: [],
    },
  },
];

async function main() {
  const payload = await getCatalog();
  if (!payload) throw new Error("Banco vazio: rode npm run sync");

  const catalog: Catalog = {
    items: new Map(payload.items.map((i) => [i.id, i])),
    champions: new Map(payload.champions.map((c) => [c.id, c])),
    rules: payload.rules,
  };

  for (const scenario of SCENARIOS) {
    const analysis = analyze(scenario.state, catalog);
    const { threat, self, enemyTeam } = analysis.context;

    console.log(`\n${"=".repeat(70)}\n${scenario.name}\n${"=".repeat(70)}`);
    console.log(
      `ameaça: ${threat.totalHealth} HP · ${threat.armor} arm · ${threat.magicResist} RM ` +
        `· EHP ${threat.effectiveHpVsPhysical}/${threat.effectiveHpVsMagic} ` +
        `· lifesteal ${threat.lifesteal}% · crit ${threat.criticalChance}%`,
    );
    console.log(
      `eu: dano ${self.primaryDamageType} · ${self.gold}g · time inimigo: ` +
        `${enemyTeam.healingSources} cura, ${enemyTeam.shieldSources} escudo, ${enemyTeam.hardCcCount} CC`,
    );
    console.log(`regras acionadas: ${analysis.firedRules.map((r) => r.slug).join(", ") || "nenhuma"}`);

    for (const [i, rec] of analysis.recommendations.entries()) {
      console.log(
        `  ${i + 1}. ${rec.item.name} (${rec.item.totalGold}g, score ${rec.score})` +
          (rec.affordable ? " ✔ cabe no ouro" : "") +
          (rec.buyNow ? ` → comprar agora: ${rec.buyNow.name} (${rec.buyNow.totalGold}g)` : ""),
      );
      for (const reason of rec.reasons) console.log(`       · ${reason.title}`);
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
