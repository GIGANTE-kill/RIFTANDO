import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  boolean,
  index,
} from "drizzle-orm/pg-core";

/** Um patch do jogo. Toda estatística numérica é versionada por patch. */
export const patches = pgTable(
  "patches",
  {
    id: serial("id").primaryKey(),
    version: text("version").notNull().unique(), // "15.17"
    releasedAt: timestamp("released_at", { withTimezone: true }),
    isCurrent: boolean("is_current").notNull().default(false),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("patches_current_idx").on(t.isCurrent)],
);

/** Log de cada execução de ingestão — auditoria de "de onde veio esse dado". */
export const syncRuns = pgTable("sync_runs", {
  id: serial("id").primaryKey(),
  patchId: integer("patch_id").references(() => patches.id, { onDelete: "cascade" }),
  source: text("source").notNull(), // "meraki:champions" | "meraki:items" | "derive:tags"
  status: text("status").notNull(), // "ok" | "failed"
  changedRows: integer("changed_rows").notNull().default(0),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Patch = typeof patches.$inferSelect;
