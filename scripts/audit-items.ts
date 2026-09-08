/**
 * Auditoria: roda o motor de itens para MUITOS campeões e denuncia recomendação
 * que não faz sentido para aquele campeão.
 *   npm run items:audit
 *
 * O objetivo não é passar no teste, é achar o que está errado.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { getCatalog } from "../src/db/queries/catalog";
import { analyze, type Catalog } from "../src/engine/itemization";
import type { ItemRef, ChampionRef } from "../src/engine/types";

/** Situações em que o item claramente não é para aquele campeão. */
function problemsFor(item: ItemRef, champion: ChampionRef, catalog: Catalog): string[] {
  const found: string[] = [];
  const s = item.stats;

  const isAD = s.attackDamage > 0 || s.criticalChance > 0 || s.lifesteal > 0;
  const isAP = s.abilityPower > 0;
  const damage = champion.officialDamageType;

  if (isAD && !isAP && damage === "MAGIC") found.push("item de ataque para campeão mágico");
  if (isAP && !isAD && damage === "PHYSICAL") found.push("item mágico para campeão de ataque");

  if (item.categories.some((c) => ["Consumable", "Trinket", "Jungle", "GoldPer", "Vision"].includes(c)))
    found.push(`categoria inválida (${item.categories.join(",")})`);

  if (item.requiredChampion && item.requiredChampion !== champion.id)
    found.push(`exclusivo de ${item.requiredChampion}`);

  if (item.totalGold < 700) found.push(`item inicial (${item.totalGold}g)`);

  // item que só rende batendo, oferecido a quem não bate (Coração de Aço num mago)
  const defensiveText = /(struck|hit) by an attack|incoming damage from attacks|reduce the attack speed|damage from attacks/i;
  const payoffText =
    /your (next|first) attack|attacks deal|attacks grant|attacks apply|on-hit|on-attack|basic attacks?|every (second|third) attack|attacking generates|energized attack/i;
  const text = item.passiveText ?? "";
  const attackItem =
    item.categories.includes("OnHit") || (!defensiveText.test(text) && payoffText.test(text));

  const dps = champion.tags.find((t) => t.slug === "SUSTAINED_DPS")?.weight ?? 0;
  const autoAttacker =
    dps >= 50 ||
    champion.classes.includes("Marksman") ||
    ((champion.classes.includes("Fighter") || champion.classes.includes("Tank")) &&
      champion.attackType === "MELEE");
  if (attackItem && !autoAttacker) found.push("item que depende de auto-ataque para quem não bate");

  // crítico para tanque
  const critChampion =
    champion.classes.includes("Marksman") ||
    (champion.tags.find((t) => t.slug === "SUSTAINED_DPS")?.weight ?? 0) >= 60;
  if (s.criticalChance > 0 && champion.classes.includes("Tank") && !critChampion)
    found.push("item de crítico para tanque");

  const supportish =
    s.healAndShieldPower > 0 ||
    item.categories.includes("Aura") ||
    item.buildsFrom.some((id) => catalog.items.get(id)?.categories.includes("GoldPer"));
  // a auditoria roda cada campeão na primeira rota dele, então "é suporte"
  // significa estar jogando de suporte — não ter a classe
  if (supportish && champion.positions[0] !== "SUPPORT")
    found.push("item de suporte para quem não está de suporte");

  return found;
}

async function main() {
  const payload = await getCatalog();
  if (!payload) throw new Error("Banco vazio: rode npm run sync");

  const catalog: Catalog = {
    items: new Map(payload.items.map((i) => [i.id, i])),
    champions: new Map(payload.champions.map((c) => [c.id, c])),
    rules: payload.rules,
  };

  // ameaças variadas para acionar regras diferentes
  const threats = [
    { id: "DrMundo", items: [3084, 3075, 3143], label: "tanque com vida alta" },
    { id: "Zed", items: [3153, 3072], label: "assassino com roubo de vida" },
    { id: "Jinx", items: [3031, 3095], label: "atiradora crítica" },
    { id: "Syndra", items: [6655, 3089], label: "maga de dano em rajada" },
  ];

  let analyses = 0;
  let flagged = 0;
  const byProblem = new Map<string, string[]>();

  for (const champion of payload.champions) {
    for (const threat of threats) {
      if (threat.id === champion.id) continue;
      const result = analyze(
        {
          selfRole: champion.positions[0],
          self: { championId: champion.id, level: 13, itemIds: [], gold: 3000 },
          threat: { championId: threat.id, level: 13, itemIds: threat.items },
          enemyTeam: [
            { championId: "Soraka", level: 13, itemIds: [] },
            { championId: "Nasus", level: 13, itemIds: [] },
          ],
        },
        catalog,
      );
      analyses++;

      for (const rec of result.recommendations) {
        const problems = problemsFor(rec.item, champion, catalog);
        if (!problems.length) continue;
        flagged++;
        for (const p of problems) {
          const list = byProblem.get(p) ?? [];
          if (list.length < 6) list.push(`${champion.name} → ${rec.item.name}`);
          byProblem.set(p, list);
        }
      }
    }
  }

  console.log(`${analyses} análises · ${flagged} recomendações problemáticas\n`);
  if (byProblem.size === 0) {
    console.log("✔ nenhum item fora de lugar");
  } else {
    for (const [problem, examples] of [...byProblem].sort()) {
      console.log(`✖ ${problem}`);
      for (const e of examples) console.log(`    ${e}`);
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
