import { config } from "dotenv";
config({ path: ".env.local" });

import { getCatalog } from "../src/db/queries/catalog";
import { analyze, type Catalog } from "../src/engine/itemization";

async function main() {
  const payload = await getCatalog();
  if (!payload) throw new Error("Banco vazio");

  const catalog: Catalog = {
    items: new Map(payload.items.map((i) => [i.id, i])),
    champions: new Map(payload.champions.map((c) => [c.id, c])),
    rules: payload.rules,
  };

  // Blitzcrank SUPORTE com aliados
  const result = analyze(
    {
      selfRole: "SUPPORT",
      self: { championId: "Blitzcrank", level: 9, itemIds: [], gold: 2000 },
      threat: { championId: "Zed", level: 9, itemIds: [3153, 3072] },
      enemyTeam: [],
    },
    catalog,
    2,
    ["Jinx", "LeeSin", "Syndra", "Darius"], // aliados
  );

  console.log("=== Blitzcrank SUPORTE ===");
  console.log("Build Path Recomendado:", result.buildPath.recommended);
  for (const p of result.buildPath.paths) {
    console.log(`  ${p.path}: ${p.score} — ${p.reasons.join(", ") || "(sem razão específica)"}`);
  }
  console.log("\nItens recomendados:");
  for (const rec of result.recommendations) {
    console.log(`  ${rec.item.name} (${rec.item.totalGold}g) — score ${rec.score}`);
  }

  // Shyvana JUNGLE (campeão misto)
  const result2 = analyze(
    {
      selfRole: "JUNGLE",
      self: { championId: "Shyvana", level: 9, itemIds: [], gold: 2000 },
      threat: { championId: "Warwick", level: 9, itemIds: [3153] },
      enemyTeam: [],
    },
    catalog,
    2,
    ["Jinx", "Thresh", "Zed", "Darius"],
  );

  console.log("\n=== Shyvana JUNGLE ===");
  console.log("Build Path Recomendado:", result2.buildPath.recommended);
  for (const p of result2.buildPath.paths) {
    console.log(`  ${p.path}: ${p.score} — ${p.reasons.join(", ") || "(sem razão específica)"}`);
  }

  // Lux MID
  const result3 = analyze(
    {
      selfRole: "MID",
      self: { championId: "Lux", level: 11, itemIds: [6655], gold: 3200 },
      threat: { championId: "Zed", level: 11, itemIds: [3153, 3072] },
      enemyTeam: [],
    },
    catalog,
    2,
    ["Jinx", "LeeSin", "Darius", "Thresh"],
  );

  console.log("\n=== Lux MID ===");
  console.log("Build Path Recomendado:", result3.buildPath.recommended);
  for (const p of result3.buildPath.paths) {
    console.log(`  ${p.path}: ${p.score} — ${p.reasons.join(", ") || "(sem razão específica)"}`);
  }

  process.exit(0);
}
main();
