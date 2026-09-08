import {
  pgTable,
  pgEnum,
  serial,
  text,
  integer,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { champions } from "./champions";
import { items } from "./items";

export const tagCategoryEnum = pgEnum("tag_category", [
  "DAMAGE_PROFILE", // BURST, SUSTAINED_DPS, DOT, TRUE_DAMAGE
  "RANGE", // MELEE_SHORT, MELEE_EXTENDED, RANGED_SHORT, RANGED_LONG
  "CROWD_CONTROL", // HARD_CC, SOFT_CC, DISPLACEMENT
  "MOBILITY", // DASH, BLINK, IMMOBILE, SPEED_BOOST
  "SUSTAIN", // LIFESTEAL, SELF_HEAL, SHIELD, DRAIN_TANK
  "PATTERN", // ALL_IN, POKE, ENGAGE, DISENGAGE, SPLIT_PUSH, SCALING, EARLY_GAME
  "DEFENSE", // TANK, BRUISER, SQUISHY
  "ITEM_EFFECT", // ANTI_HEAL, PERCENT_HP_DMG, ARMOR_PEN, ...
]);

/** Origem do vínculo: `manual` sempre vence `derived` (ver derive-champion-tags.ts). */
export const tagSourceEnum = pgEnum("tag_source", ["derived", "manual"]);

export const tags = pgTable("tags", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(), // "RANGED_LONG"
  category: tagCategoryEnum("category").notNull(),
  label: text("label").notNull(), // "Alcance longo"
  description: text("description"),
});

/**
 * weight 0-100 permite score contínuo: Jhin é RANGED_LONG(100)/POKE(70),
 * enquanto Ashe é RANGED_LONG(100)/POKE(30).
 */
export const championTags = pgTable(
  "champion_tags",
  {
    championId: text("champion_id")
      .notNull()
      .references(() => champions.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    weight: integer("weight").notNull().default(100),
    source: tagSourceEnum("source").notNull().default("derived"),
    note: text("note"), // por que você corrigiu à mão
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.championId, t.tagId] }),
    index("champion_tags_tag_idx").on(t.tagId),
  ],
);

export const itemTags = pgTable(
  "item_tags",
  {
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    weight: integer("weight").notNull().default(100),
    source: tagSourceEnum("source").notNull().default("derived"),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.tagId] }),
    index("item_tags_tag_idx").on(t.tagId),
  ],
);

export type Tag = typeof tags.$inferSelect;
