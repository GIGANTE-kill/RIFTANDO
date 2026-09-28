/**
 * Copia o catálogo do banco local (PGlite) para um Postgres remoto.
 *
 *   TARGET_DATABASE_URL="postgresql://…" npm run db:copy
 *
 * Para quando o `npm run sync` não roda na máquina que precisa do dado — rede
 * que bloqueia o Data Dragon, por exemplo — mas o banco local já está
 * sincronizado. O destino precisa já ter as tabelas (`drizzle-kit push`).
 *
 * Idempotente: linhas que já existem no destino são mantidas. Os ids são
 * copiados como estão, para que as referências (tag_id, patch_id) continuem
 * valendo, e as sequências são acertadas no fim.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { sql, type Table, getTableName } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "../src/db/schema";

// na ordem das chaves estrangeiras: quem é referenciado vem antes
const TABLES: Table[] = [
  schema.patches,
  schema.syncRuns,
  schema.champions,
  schema.championPatchStats,
  schema.items,
  schema.itemPatchStats,
  schema.tags,
  schema.championTags,
  schema.itemTags,
  schema.counterRules,
  schema.matchupTagRules,
  schema.championMatchupOverrides,
  schema.riotAccounts,
  schema.riotMatches,
  schema.matchParticipants,
];

/** Tabelas com id `serial`: a sequência precisa andar até o maior id copiado. */
const SERIAL_TABLES = [
  "patches",
  "sync_runs",
  "tags",
  "counter_rules",
  "matchup_tag_rules",
  "champion_matchup_overrides",
];

async function main() {
  const target = process.env.TARGET_DATABASE_URL;
  if (!target || !/^postgres(ql)?:/.test(target))
    throw new Error("Defina TARGET_DATABASE_URL com a URL postgresql:// do destino.");
  const localPath = (process.env.LOCAL_DATABASE_URL ?? "file:./.pglite").replace(/^file:/, "");

  const local = drizzlePglite(new PGlite(localPath), { schema });
  const client = postgres(target, { max: 1, prepare: false });
  const remote = drizzlePostgres(client, { schema });

  for (const table of TABLES) {
    const name = getTableName(table);
    const rows = (await local.select().from(table)) as Record<string, unknown>[];
    let copied = 0;
    // lotes pequenos: champion_patch_stats carrega o texto das habilidades
    for (let i = 0; i < rows.length; i += 50) {
      const batch = rows.slice(i, i + 50);
      const result = await remote.insert(table).values(batch).onConflictDoNothing().returning();
      copied += result.length;
    }
    console.log(`${name.padEnd(28)} ${String(rows.length).padStart(5)} no local · ${String(copied).padStart(5)} novas no destino`);
  }

  for (const name of SERIAL_TABLES) {
    await remote.execute(
      sql.raw(
        `select setval(pg_get_serial_sequence('"${name}"', 'id'), coalesce((select max(id) from "${name}"), 1))`,
      ),
    );
  }
  console.log("\nsequências acertadas — pronto");
  await client.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
