/**
 * Aplica o derivador heurístico sobre o patch atual.
 *   npm run tags:derive
 *
 * Preserva overrides: apaga e reescreve APENAS as linhas com source='derived'.
 * Qualquer tag que você tenha marcado como 'manual' sobrevive a todo re-sync.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  patches,
  tags,
  champions,
  championPatchStats,
  championTags,
  items,
  itemPatchStats,
  itemTags,
  syncRuns,
} from "../src/db/schema";
import { TAG_CATALOG } from "../src/engine/tag-catalog";
import { deriveChampionTags, deriveItemTags } from "../src/engine/derive-tags";

async function ensureTagCatalog() {
  for (const tag of TAG_CATALOG) {
    await db
      .insert(tags)
      .values({
        slug: tag.slug,
        category: tag.category,
        label: tag.label,
        description: tag.description ?? null,
      })
      .onConflictDoUpdate({
        target: tags.slug,
        set: { category: tag.category, label: tag.label, description: tag.description ?? null },
      });
  }
  const rows = await db.select({ id: tags.id, slug: tags.slug }).from(tags);
  return new Map(rows.map((r) => [r.slug, r.id]));
}

async function main() {
  const [patch] = await db.select().from(patches).where(eq(patches.isCurrent, true)).limit(1);
  if (!patch) throw new Error("Nenhum patch atual. Rode `npm run sync` primeiro.");

  const tagId = await ensureTagCatalog();
  console.log(`▶ Catálogo: ${tagId.size} tags`);

  // ---------- campeões ----------
  const champRows = await db
    .select({
      id: champions.id,
      name: champions.name,
      classes: champions.classes,
      stats: championPatchStats,
    })
    .from(champions)
    .innerJoin(championPatchStats, eq(championPatchStats.championId, champions.id))
    .where(eq(championPatchStats.patchId, patch.id));

  let champLinks = 0;
  for (const row of champRows) {
    const derived = deriveChampionTags({
      classes: row.classes,
      attackRange: row.stats.attackRange,
      hp: row.stats.hp,
      armor: row.stats.armor,
      magicResist: row.stats.magicResist,
      abilities: row.stats.abilities,
    });

    // limpa só o que é derivado — overrides manuais permanecem
    await db
      .delete(championTags)
      .where(and(eq(championTags.championId, row.id), eq(championTags.source, "derived")));

    const manual = await db
      .select({ tagId: championTags.tagId })
      .from(championTags)
      .where(eq(championTags.championId, row.id));
    const manualIds = new Set(manual.map((m) => m.tagId));

    const values = derived
      .map((d) => ({ championId: row.id, tagId: tagId.get(d.slug)!, weight: d.weight, source: "derived" as const }))
      .filter((v) => v.tagId && !manualIds.has(v.tagId));

    if (values.length) {
      await db.insert(championTags).values(values).onConflictDoNothing();
      champLinks += values.length;
    }
  }
  console.log(`  ✔ ${champRows.length} campeões → ${champLinks} tags derivadas`);

  // ---------- itens ----------
  const itemRows = await db
    .select({ id: items.id, categories: items.categories, stats: itemPatchStats })
    .from(items)
    .innerJoin(itemPatchStats, eq(itemPatchStats.itemId, items.id))
    .where(and(eq(itemPatchStats.patchId, patch.id), eq(items.isPurchasable, true)));

  let itemLinks = 0;
  for (const row of itemRows) {
    const derived = deriveItemTags({ ...row.stats, categories: row.categories });
    await db.delete(itemTags).where(and(eq(itemTags.itemId, row.id), eq(itemTags.source, "derived")));

    const values = derived
      .map((d) => ({ itemId: row.id, tagId: tagId.get(d.slug)!, weight: d.weight, source: "derived" as const }))
      .filter((v) => v.tagId);

    if (values.length) {
      await db.insert(itemTags).values(values).onConflictDoNothing();
      itemLinks += values.length;
    }
  }
  console.log(`  ✔ ${itemRows.length} itens → ${itemLinks} tags derivadas`);

  await db.insert(syncRuns).values({
    patchId: patch.id,
    source: "derive:tags",
    status: "ok",
    changedRows: champLinks + itemLinks,
  });
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
