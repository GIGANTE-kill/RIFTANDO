/** Valida fontes + derivador sem tocar no banco: npx tsx scripts/_smoke.ts */
import { fetchLatestVersion, fetchChampions, fetchItemStats, DDRAGON_STAT_MAP } from "../src/lib/sources/ddragon";
import { fetchItems, parseStatsFromDescription, extractPassiveText } from "../src/lib/sources/cdragon";
import { deriveChampionTags, deriveItemTags } from "../src/engine/derive-tags";
import type { AbilitySnapshot } from "../src/db/schema/champions";

const SPELL_KEYS = ["Q", "W", "E", "R"] as const;

function parseMarkup(tooltip: string) {
  const markers = [...new Set([...tooltip.matchAll(/<([a-zA-Z]+)>/g)].map((m) => m[1]))];
  const statuses = [...new Set([...tooltip.matchAll(/<status>(.*?)<\/status>/gs)].map((m) => m[1].trim()))];
  const damageTypes: AbilitySnapshot["damageTypes"] = [];
  if (markers.includes("physicalDamage")) damageTypes.push("PHYSICAL");
  if (markers.includes("magicDamage")) damageTypes.push("MAGIC");
  if (markers.includes("trueDamage")) damageTypes.push("TRUE");
  return { markers, statuses, damageTypes };
}
const clean = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\{\{.*?\}\}/g, " ").replace(/\s+/g, " ").trim();

async function main() {
  const version = await fetchLatestVersion();
  console.log(`Patch Data Dragon: ${version}\n`);

  const champs = await fetchChampions(version);
  const sample = ["Aatrox", "Jhin", "Malphite", "Soraka", "Zed", "Nasus", "Lux", "Vayne"];

  for (const c of champs.filter((x) => sample.includes(x.id))) {
    const abilities: AbilitySnapshot[] = [];
    if (c.passive) {
      const m = parseMarkup(c.passive.description);
      abilities.push({ key: "P", name: c.passive.name, ...m, cooldownByRank: [], costByRank: [], rangeByRank: [], text: clean(c.passive.description) });
    }
    c.spells.slice(0, 4).forEach((s, i) => {
      const src = s.tooltip || s.description;
      abilities.push({ key: SPELL_KEYS[i], name: s.name, ...parseMarkup(src), cooldownByRank: s.cooldown, costByRank: s.cost, rangeByRank: s.range.map((r) => (r >= 25000 ? 0 : r)), text: clean(src) });
    });

    const tags = deriveChampionTags({
      attackRange: c.stats.attackrange ?? 0,
      hp: c.stats.hp ?? 0,
      armor: c.stats.armor ?? 0,
      magicResist: c.stats.spellblock ?? 0,
      classes: c.tags,
      abilities,
    });
    console.log(`${c.name.padEnd(10)} [${c.tags.join(",")}] range ${c.stats.attackrange}`);
    console.log("  " + tags.sort((a, b) => b.weight - a.weight).map((t) => `${t.slug}:${t.weight}`).join(" ") + "\n");
  }

  const [catalog, ddStats] = await Promise.all([fetchItems(), fetchItemStats(version)]);
  const itemSample = [3153, 3033, 3075, 6665, 3123, 3916, 3814, 3047];
  console.log("--- itens ---");
  for (const id of itemSample) {
    const it = catalog.find((i) => i.id === id);
    if (!it) { console.log(id, "não encontrado"); continue; }
    const stats: Record<string, number> = {};
    for (const [k, v] of Object.entries(ddStats[String(id)]?.stats ?? {})) {
      const m = DDRAGON_STAT_MAP[k];
      if (m) stats[m.column] = (stats[m.column] ?? 0) + v * m.scale;
    }
    for (const [c, v] of Object.entries(parseStatsFromDescription(it.description))) stats[c] = Math.max(stats[c] ?? 0, v);

    const tags = deriveItemTags({
      categories: it.categories,
      passiveText: extractPassiveText(it.description),
      health: stats.health ?? 0, armor: stats.armor ?? 0, magicResist: stats.magicResist ?? 0,
      attackSpeed: stats.attackSpeed ?? 0, criticalChance: stats.criticalChance ?? 0,
      lifesteal: stats.lifesteal ?? 0, omnivamp: stats.omnivamp ?? 0,
      armorPen: stats.armorPen ?? 0, magicPen: stats.magicPen ?? 0, tenacity: stats.tenacity ?? 0,
    });
    console.log(`${it.name} (${id}) ${it.priceTotal}g`);
    console.log("  stats:", JSON.stringify(stats));
    console.log("  tags:", tags.map((t) => t.slug).join(" ") || "(nenhuma)");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
