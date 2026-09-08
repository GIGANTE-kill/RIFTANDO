import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Next lê .env.local automaticamente; drizzle-kit e os scripts tsx não.
config({ path: ".env.local" });

const url = process.env.DATABASE_URL ?? "file:./.pglite";
const isEmbedded = url.startsWith("file:");

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // PGlite embutido em dev; qualquer servidor Postgres em produção
  ...(isEmbedded ? { driver: "pglite" as const } : {}),
  dbCredentials: { url },
  verbose: true,
  strict: true,
});
