import { z } from "zod";

export const MERAKI_BASE = "https://cdn.merakianalytics.com/riot/lol/resources/latest/en";
export const CDRAGON_RAW = "https://raw.communitydragon.org/latest";

export const championIconUrl = (riotId: number) =>
  `${CDRAGON_RAW}/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/${riotId}.png`;

export const championSplashUrl = (riotId: number) =>
  `${CDRAGON_RAW}/plugins/rcp-be-lol-game-data/global/default/v1/champion-splashes/${riotId}/${riotId}000.jpg`;

/** iconPath do Meraki vem como "/lol-game-data/assets/ASSETS/Items/Icons2D/x.png" */
export const itemIconUrl = (iconPath?: string | null) =>
  iconPath
    ? `${CDRAGON_RAW}/plugins/rcp-be-lol-game-data/global/default/${iconPath
        .toLowerCase()
        .replace("/lol-game-data/assets/", "")}`
    : null;

/** Todo stat do Meraki é { flat, percent, perLevel, ... } — campos opcionais. */
const StatBlock = z
  .object({
    flat: z.number().optional(),
    percent: z.number().optional(),
    perLevel: z.number().optional(),
    percentPerLevel: z.number().optional(),
    percentBase: z.number().optional(),
    percentBonus: z.number().optional(),
  })
  .passthrough();

export const MerakiChampionSchema = z
  .object({
    id: z.number(),
    key: z.string(),
    name: z.string(),
    title: z.string().nullish(),
    attackType: z.string(),
    resource: z.string().nullish(),
    patch: z.string().nullish(),
    roles: z.array(z.string()).default([]),
    stats: z.record(z.string(), StatBlock),
    abilities: z.record(z.string(), z.array(z.any())).default({}),
  })
  .passthrough();

export const MerakiItemSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    tier: z.number().nullish(),
    rank: z.array(z.string()).nullish(),
    shop: z.object({
      prices: z.object({ total: z.number().default(0) }).passthrough(),
      purchasable: z.boolean().default(true),
      tags: z.array(z.string()).default([]),
    }),
    stats: z.record(z.string(), StatBlock).default({}),
    passives: z.array(z.any()).default([]),
    active: z.array(z.any()).default([]),
    iconPath: z.string().nullish(),
    icon: z.string().nullish(),
  })
  .passthrough();

export type MerakiChampion = z.infer<typeof MerakiChampionSchema>;
export type MerakiItem = z.infer<typeof MerakiItemSchema>;

export async function fetchJson<T>(url: string, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(url, {
    headers: { "user-agent": "riftando-sync/0.1" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error(`Schema inesperado em ${url}: ${parsed.error.issues.slice(0, 3).map((i) => i.path.join(".") + " " + i.message).join("; ")}`);
  }
  return parsed.data;
}

export const flat = (s?: z.infer<typeof StatBlock>) => s?.flat ?? 0;
export const perLevel = (s?: z.infer<typeof StatBlock>) => s?.perLevel ?? 0;
/** Alguns stats de item vêm em `percent` (attackSpeed, lifesteal, crit). */
export const flatOrPercent = (s?: z.infer<typeof StatBlock>) => s?.flat || s?.percent || 0;
