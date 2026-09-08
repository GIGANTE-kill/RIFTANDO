import {
  pgTable,
  integer,
  text,
  boolean,
  real,
  jsonb,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { patches } from "./patches";

export const items = pgTable("items", {
  id: integer("id").primaryKey(), // id oficial do item (ex.: 3153 Lâmina)
  name: text("name").notNull(),
  /** categorias oficiais da Riot: Damage, ArmorPenetration, Tenacity, OnHit... */
  categories: text("categories").array().notNull().default([]),
  buildsFrom: integer("builds_from").array().notNull().default([]),
  buildsInto: integer("builds_into").array().notNull().default([]),
  /** item final = não constrói em nada e custa caro; usado para filtrar sugestões */
  isLegendary: boolean("is_legendary").notNull().default(false),
  isPurchasable: boolean("is_purchasable").notNull().default(true),
  requiredChampion: text("required_champion"),
  iconUrl: text("icon_url"),
});

/**
 * Stats normalizados em colunas (o motor consulta direto, sem parsear jsonb)
 * + `raw` para qualquer campo que a gente ainda não modelou.
 */
export const itemPatchStats = pgTable(
  "item_patch_stats",
  {
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    patchId: integer("patch_id")
      .notNull()
      .references(() => patches.id, { onDelete: "cascade" }),
    totalGold: integer("total_gold").notNull().default(0),

    health: real("health").notNull().default(0),
    armor: real("armor").notNull().default(0),
    magicResist: real("magic_resist").notNull().default(0),
    attackDamage: real("attack_damage").notNull().default(0),
    abilityPower: real("ability_power").notNull().default(0),
    attackSpeed: real("attack_speed").notNull().default(0),
    criticalChance: real("critical_chance").notNull().default(0),
    lifesteal: real("lifesteal").notNull().default(0),
    omnivamp: real("omnivamp").notNull().default(0),
    abilityHaste: real("ability_haste").notNull().default(0),
    moveSpeed: real("move_speed").notNull().default(0),
    tenacity: real("tenacity").notNull().default(0),
    armorPen: real("armor_pen").notNull().default(0),
    magicPen: real("magic_pen").notNull().default(0),
    healAndShieldPower: real("heal_and_shield_power").notNull().default(0),

    /** texto dos passivos/ativos — fonte do derivador de ITEM_EFFECT tags */
    passiveText: text("passive_text"),
    raw: jsonb("raw").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.patchId] }),
    index("ips_patch_idx").on(t.patchId),
  ],
);

export type Item = typeof items.$inferSelect;
export type ItemPatchStats = typeof itemPatchStats.$inferSelect;
