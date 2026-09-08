/**
 * Data Dragon (Riot oficial) — fonte primária de PATCH e STATS de campeão.
 * Atualiza a cada patch, sem intermediários.
 */
import { z } from "zod";

export const DDRAGON = "https://ddragon.leagueoflegends.com";

const SpellSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    tooltip: z.string().default(""),
    description: z.string().default(""),
    maxrank: z.number().default(5),
    cooldown: z.array(z.number()).default([]),
    cost: z.array(z.number()).default([]),
    range: z.array(z.number()).default([]),
  })
  .passthrough();

export const DDragonChampionSchema = z
  .object({
    id: z.string(), // "Aatrox"
    key: z.string(), // "266" (id numérico, como string)
    name: z.string(),
    title: z.string().default(""),
    tags: z.array(z.string()).default([]), // ["Fighter"]
    partype: z.string().default(""),
    stats: z.record(z.string(), z.number()),
    spells: z.array(SpellSchema).default([]),
    passive: z.object({ name: z.string(), description: z.string().default("") }).optional(),
  })
  .passthrough();

export const DDragonItemSchema = z
  .object({
    name: z.string(),
    gold: z.object({ total: z.number().default(0), purchasable: z.boolean().default(true) }),
    stats: z.record(z.string(), z.number()).default({}),
    /** "11" = Summoner's Rift. Só esse mapa nos interessa. */
    maps: z.record(z.string(), z.boolean()).default({}),
    inStore: z.boolean().optional(),
    depth: z.number().optional(),
  })
  .passthrough();

export type DDragonChampion = z.infer<typeof DDragonChampionSchema>;
export type DDragonItem = z.infer<typeof DDragonItemSchema>;

// genérico sobre o schema (não sobre T) para que a inferência use o tipo de
// SAÍDA do zod — com os .default() já aplicados, sem opcionais fantasmas.
export async function fetchJson<S extends z.ZodTypeAny>(
  url: string,
  schema: S,
): Promise<z.infer<S>> {
  const res = await fetch(url, { headers: { "user-agent": "riftando-sync/0.1" }, cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) {
    const first = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Schema inesperado em ${url} → ${first.join(" | ")}`);
  }
  return parsed.data;
}

/** Versão mais recente publicada pela Riot (ex.: "16.17.1"). */
export async function fetchLatestVersion(): Promise<string> {
  const versions = await fetchJson(`${DDRAGON}/api/versions.json`, z.array(z.string()).min(1));
  return versions[0];
}

/**
 * `en_US` é a língua da LÓGICA: o derivador de tags lê os marcadores e as
 * palavras-chave dos tooltips em inglês. `pt_BR` é a língua da TELA.
 * Buscamos as duas e usamos cada uma no seu lugar.
 */
export type Locale = "en_US" | "pt_BR";

export async function fetchChampions(version: string, locale: Locale = "en_US") {
  const payload = await fetchJson(
    `${DDRAGON}/cdn/${version}/data/${locale}/championFull.json`,
    z.object({ data: z.record(z.string(), DDragonChampionSchema) }).passthrough(),
  );
  return Object.values(payload.data);
}

/** Stats numéricos de item, indexados por id. Chaves legadas da Riot. */
export async function fetchItemStats(version: string, locale: Locale = "en_US") {
  const payload = await fetchJson(
    `${DDRAGON}/cdn/${version}/data/${locale}/item.json`,
    z.object({ data: z.record(z.string(), DDragonItemSchema) }).passthrough(),
  );
  return payload.data;
}

/** Mapa chave-legada → coluna do nosso schema. Percentuais chegam como 0.25. */
export const DDRAGON_STAT_MAP: Record<string, { column: string; scale: number }> = {
  FlatHPPoolMod: { column: "health", scale: 1 },
  FlatArmorMod: { column: "armor", scale: 1 },
  FlatSpellBlockMod: { column: "magicResist", scale: 1 },
  FlatPhysicalDamageMod: { column: "attackDamage", scale: 1 },
  FlatMagicDamageMod: { column: "abilityPower", scale: 1 },
  PercentAttackSpeedMod: { column: "attackSpeed", scale: 100 },
  FlatCritChanceMod: { column: "criticalChance", scale: 100 },
  PercentLifeStealMod: { column: "lifesteal", scale: 100 },
  FlatMovementSpeedMod: { column: "moveSpeed", scale: 1 },
  PercentMovementSpeedMod: { column: "moveSpeed", scale: 100 },
};
