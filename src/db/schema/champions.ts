import {
  pgTable,
  pgEnum,
  text,
  integer,
  real,
  jsonb,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { patches } from "./patches";

export const attackTypeEnum = pgEnum("attack_type", ["MELEE", "RANGED"]);
export const laneRoleEnum = pgEnum("lane_role", ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"]);
export const damageTypeEnum = pgEnum("damage_type", [
  "PHYSICAL",
  "MAGIC",
  "TRUE",
  "MIXED",
  "NONE",
]);

/**
 * Snapshot de uma habilidade num patch — base para diffs entre versões.
 *
 * `markers` e `statuses` vêm da marcação semântica do tooltip da Riot
 * (<physicalDamage>, <healing>, <shield>, <status>Stunned</status>...).
 * É vocabulário fechado e localizado pela própria Riot — sinal muito mais
 * confiável para o derivador de tags do que casar prosa em inglês.
 */
export type AbilitySnapshot = {
  key: "P" | "Q" | "W" | "E" | "R";
  name: string;
  damageTypes: ("PHYSICAL" | "MAGIC" | "TRUE")[];
  markers: string[]; // ["physicalDamage", "healing", "shield", "slow", ...]
  statuses: string[]; // ["Knocked Up", "Stunned", "Slowed", ...]
  cooldownByRank: number[];
  costByRank: number[];
  rangeByRank: number[];
  /** tooltip sem marcação — fallback textual do derivador */
  text: string;
};

/** Identidade do campeão: estável entre patches. */
export const champions = pgTable("champions", {
  id: text("id").primaryKey(), // chave Meraki: "Aatrox", "MonkeyKing"
  riotId: integer("riot_id").notNull(),
  name: text("name").notNull(),
  title: text("title"),
  attackType: attackTypeEnum("attack_type").notNull(),
  resource: text("resource"), // "Mana", "Energy", "Blood Well", ...
  /** classes da Riot: Fighter, Mage, Marksman, Assassin, Tank, Support */
  classes: text("classes").array().notNull().default([]),
  /** rotas em que o campeão é jogado — base do assistente de seleção */
  positions: laneRoleEnum("positions").array().notNull().default([]),
  primaryRoles: laneRoleEnum("primary_roles").array().notNull().default([]),
  /** tipo de dano segundo a própria Riot, mais confiável que inferir do texto */
  officialDamageType: damageTypeEnum("official_damage_type"),
  /** 1 fácil, 2 médio, 3 difícil (tacticalInfo.difficulty) */
  difficulty: integer("difficulty"),
  /** playstyleInfo da Riot: cada eixo de 1 a 3 */
  playstyle: jsonb("playstyle").$type<Playstyle>(),
  iconUrl: text("icon_url"),
  splashUrl: text("splash_url"),
});

export type Playstyle = {
  damage: number;
  durability: number;
  crowdControl: number;
  mobility: number;
  utility: number;
};

/** Estatísticas numéricas por patch. PK composta => idempotente e diffável. */
export const championPatchStats = pgTable(
  "champion_patch_stats",
  {
    championId: text("champion_id")
      .notNull()
      .references(() => champions.id, { onDelete: "cascade" }),
    patchId: integer("patch_id")
      .notNull()
      .references(() => patches.id, { onDelete: "cascade" }),
    hp: real("hp").notNull().default(0),
    hpPerLevel: real("hp_per_level").notNull().default(0),
    armor: real("armor").notNull().default(0),
    armorPerLevel: real("armor_per_level").notNull().default(0),
    magicResist: real("magic_resist").notNull().default(0),
    mrPerLevel: real("mr_per_level").notNull().default(0),
    attackDamage: real("attack_damage").notNull().default(0),
    adPerLevel: real("ad_per_level").notNull().default(0),
    attackSpeed: real("attack_speed").notNull().default(0),
    moveSpeed: real("move_speed").notNull().default(0),
    attackRange: real("attack_range").notNull().default(0),
    abilities: jsonb("abilities").$type<AbilitySnapshot[]>().notNull().default([]),
  },
  (t) => [
    primaryKey({ columns: [t.championId, t.patchId] }),
    index("cps_patch_idx").on(t.patchId),
  ],
);

export type Champion = typeof champions.$inferSelect;
export type ChampionPatchStats = typeof championPatchStats.$inferSelect;
