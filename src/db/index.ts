import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Dois drivers, mesma API do Drizzle:
 *   - "file:./.pglite"  → PGlite: Postgres real em WASM, embutido, zero instalação.
 *   - "postgresql://…"  → servidor de verdade (Docker, Neon, Supabase, RDS).
 *
 * Trocar entre eles é editar DATABASE_URL — nenhuma query muda. PGlite é o
 * Postgres compilado para WASM, não uma emulação: enums, arrays e jsonb
 * se comportam igual.
 */
const url = process.env.DATABASE_URL ?? "file:./.pglite";
export const isEmbedded = url.startsWith("file:");

type Database = ReturnType<typeof drizzlePglite<typeof schema>>;

// Singleton: em dev o Next recarrega os módulos a cada edição. Sem isso o pool
// vaza conexões — e o PGlite tentaria abrir o mesmo diretório duas vezes.
const globalForDb = globalThis as unknown as { riftandoDb?: Database };

function create(): Database {
  if (isEmbedded) {
    return drizzlePglite(new PGlite(url.replace(/^file:/, "")), { schema });
  }
  const client = postgres(url, {
    max: process.env.NODE_ENV === "production" ? 10 : 3,
    prepare: false,
  });
  // as duas instâncias são estruturalmente equivalentes para as nossas queries
  return drizzlePostgres(client, { schema }) as unknown as Database;
}

/**
 * Aberto na primeira consulta, não no import. O build do Next carrega cada
 * rota em vários workers ao mesmo tempo só para coletar metadados — abrir o
 * PGlite no import fazia todos disputarem o mesmo diretório (e um abortava).
 */
export const db: Database = new Proxy({} as Database, {
  get(_, prop) {
    const real = (globalForDb.riftandoDb ??= create());
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
export { schema };
