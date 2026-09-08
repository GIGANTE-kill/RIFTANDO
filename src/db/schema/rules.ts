import {
  pgTable,
  pgEnum,
  serial,
  text,
  integer,
  jsonb,
  boolean,
  index,
  unique,
} from "drizzle-orm/pg-core";
import type { RuleCondition } from "@/engine/rules-dsl";

export const rulePhaseEnum = pgEnum("rule_phase", ["EARLY", "MID", "LATE", "ANY"]);

/**
 * Regra de contra-item, avaliada por src/engine/itemization.ts.
 * `condition` usa o DSL de src/engine/rules-dsl.ts, ex.:
 *   { all: [
 *       { metric: "threat.totalHealth", op: ">=", value: 3000 },
 *       { metric: "self.primaryDamageType", op: "eq", value: "PHYSICAL" }
 *   ]}
 */
export const counterRules = pgTable(
  "counter_rules",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    priority: integer("priority").notNull().default(50), // 0-100, ordena a saída
    condition: jsonb("condition").$type<RuleCondition>().notNull(),
    recommendTagSlugs: text("recommend_tag_slugs").array().notNull().default([]),
    recommendItemIds: integer("recommend_item_ids").array().notNull().default([]),
    excludeItemIds: integer("exclude_item_ids").array().notNull().default([]),
    /** frase exibida no card e no "Diagnóstico Tático" */
    explanation: text("explanation").notNull(),
    phase: rulePhaseEnum("phase").notNull().default("ANY"),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [index("counter_rules_priority_idx").on(t.priority)],
);

/**
 * Vantagem de fase de rota por confronto de tags.
 * Ex.: RANGED_LONG vs ALL_IN => +2 "Use o alcance para negar o farm antes do lvl 6".
 */
export const matchupTagRules = pgTable(
  "matchup_tag_rules",
  {
    id: serial("id").primaryKey(),
    selfTagSlug: text("self_tag_slug").notNull(),
    enemyTagSlug: text("enemy_tag_slug").notNull(),
    advantage: integer("advantage").notNull(), // -5..+5
    guideline: text("guideline").notNull(),
    phase: rulePhaseEnum("phase").notNull().default("EARLY"),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [unique("matchup_tag_pair_uq").on(t.selfTagSlug, t.enemyTagSlug, t.phase)],
);

/** Override curado de um confronto específico, quando as tags erram. */
export const championMatchupOverrides = pgTable(
  "champion_matchup_overrides",
  {
    id: serial("id").primaryKey(),
    selfChampionId: text("self_champion_id").notNull(),
    enemyChampionId: text("enemy_champion_id").notNull(),
    advantage: integer("advantage").notNull(),
    guideline: text("guideline").notNull(),
  },
  (t) => [unique("champion_matchup_uq").on(t.selfChampionId, t.enemyChampionId)],
);

export type CounterRule = typeof counterRules.$inferSelect;
export type MatchupTagRule = typeof matchupTagRules.$inferSelect;
