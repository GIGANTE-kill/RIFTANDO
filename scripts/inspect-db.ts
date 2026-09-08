import { config } from "dotenv";
config({ path: ".env.local" });

import { sql, eq, desc } from "drizzle-orm";
import { db } from "../src/db";
import { championTags, tags, items, itemTags, itemPatchStats } from "../src/db/schema";

async function main() {
const champCounts = await db
  .select({ slug: tags.slug, n: sql<number>`count(*)::int` })
  .from(championTags)
  .innerJoin(tags, eq(tags.id, championTags.tagId))
  .groupBy(tags.slug)
  .orderBy(desc(sql`count(*)`));
console.log("=== tags de campeão ===");
console.log(champCounts.map((r) => `${r.slug}:${r.n}`).join("  "));

const itemCounts = await db
  .select({ slug: tags.slug, n: sql<number>`count(*)::int` })
  .from(itemTags)
  .innerJoin(tags, eq(tags.id, itemTags.tagId))
  .groupBy(tags.slug)
  .orderBy(desc(sql`count(*)`));
console.log("\n=== tags de item ===");
console.log(itemCounts.map((r) => `${r.slug}:${r.n}`).join("  "));

const antiheal = await db
  .select({ name: items.name, gold: itemPatchStats.totalGold })
  .from(itemTags)
  .innerJoin(tags, eq(tags.id, itemTags.tagId))
  .innerJoin(items, eq(items.id, itemTags.itemId))
  .innerJoin(itemPatchStats, eq(itemPatchStats.itemId, items.id))
  .where(eq(tags.slug, "ANTI_HEAL"));
console.log("\n=== corta-cura no banco ===");
console.log(antiheal.map((i) => `${i.name} (${i.gold}g)`).join(", "));

const pctHp = await db
  .select({ name: items.name })
  .from(itemTags)
  .innerJoin(tags, eq(tags.id, itemTags.tagId))
  .innerJoin(items, eq(items.id, itemTags.itemId))
  .where(eq(tags.slug, "PERCENT_HP_DMG"));
console.log("\n=== dano por % de vida ===");
console.log(pctHp.map((i) => i.name).join(", "));
process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
