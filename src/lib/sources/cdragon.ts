/**
 * CommunityDragon — itens completos (868 vs 320 da Meraki), com `categories`
 * controladas pela Riot, árvore de build (`from`/`to`) e texto das passivas.
 * As categorias são o sinal mais confiável para tags de item: vocabulário fechado.
 */
import { z } from "zod";
import { fetchJson } from "./ddragon";

export const CDRAGON_RAW = "https://raw.communitydragon.org/latest";
const GAME_DATA = `${CDRAGON_RAW}/plugins/rcp-be-lol-game-data/global/default`;

export const championIconUrl = (riotId: number) =>
  `${GAME_DATA}/v1/champion-icons/${riotId}.png`;

export const championSplashUrl = (riotId: number) =>
  `${GAME_DATA}/v1/champion-splashes/${riotId}/${riotId}000.jpg`;

/** iconPath vem como "/lol-game-data/assets/ASSETS/Items/Icons2D/x.png" */
export const itemIconUrl = (iconPath?: string | null) =>
  iconPath
    ? `${GAME_DATA}/${iconPath.toLowerCase().replace("/lol-game-data/assets/", "")}`
    : null;

export const CDragonItemSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    description: z.string().default(""),
    active: z.boolean().default(false),
    inStore: z.boolean().default(true),
    from: z.array(z.number()).default([]),
    to: z.array(z.number()).default([]),
    categories: z.array(z.string()).default([]),
    price: z.number().default(0),
    priceTotal: z.number().default(0),
    iconPath: z.string().nullish(),
    requiredChampion: z.string().default(""),
  })
  .passthrough();

export type CDragonItem = z.infer<typeof CDragonItemSchema>;

export async function fetchItems() {
  return fetchJson(`${GAME_DATA}/v1/items.json`, z.array(CDragonItemSchema));
}

const ChampionDetailSchema = z
  .object({
    id: z.number(),
    alias: z.string().default(""),
    tacticalInfo: z
      .object({
        style: z.number().optional(),
        difficulty: z.number().optional(),
        damageType: z.string().optional(), // kPhysical | kMagic | kMixed
        attackType: z.string().optional(),
      })
      .default({}),
    playstyleInfo: z
      .object({
        damage: z.number().default(0),
        durability: z.number().default(0),
        crowdControl: z.number().default(0),
        mobility: z.number().default(0),
        utility: z.number().default(0),
      })
      .default({ damage: 0, durability: 0, crowdControl: 0, mobility: 0, utility: 0 }),
  })
  .passthrough();

export type CDragonChampionDetail = z.infer<typeof ChampionDetailSchema>;

/**
 * Ficha oficial por campeão: tipo de dano, dificuldade e os cinco eixos de
 * estilo de jogo que a Riot mostra na tela de seleção. São ~240 requisições,
 * mas em lotes leva menos de 5 segundos.
 */
export async function fetchChampionDetails(riotIds: number[]) {
  const out = new Map<number, CDragonChampionDetail>();
  const BATCH = 25;

  for (let i = 0; i < riotIds.length; i += BATCH) {
    const batch = await Promise.all(
      riotIds.slice(i, i + BATCH).map(async (id) => {
        try {
          return await fetchJson(`${GAME_DATA}/v1/champions/${id}.json`, ChampionDetailSchema);
        } catch {
          return null; // campeão sem ficha não impede o sync
        }
      }),
    );
    for (const detail of batch) if (detail) out.set(detail.id, detail);
  }
  return out;
}

/** Versão do conteúdo servido pelo CDragon — usada só para auditoria. */
export async function fetchContentVersion() {
  const meta = await fetchJson(
    `${CDRAGON_RAW}/content-metadata.json`,
    z.object({ version: z.string() }).passthrough(),
  );
  return meta.version;
}

const STAT_LINE = /<attention>\s*([\d.]+)(%?)<\/attention>\s*([A-Za-z' ]+)/g;

/**
 * Stats que o Data Dragon não expõe (Ability Haste, penetração, tenacidade,
 * omnivamp) só existem no bloco <stats> do texto. Parse determinístico.
 */
export function parseStatsFromDescription(description: string): Record<string, number> {
  const block = description.match(/<stats>(.*?)<\/stats>/s)?.[1];
  if (!block) return {};

  const LABELS: Record<string, string> = {
    "health": "health",
    "armor": "armor",
    "magic resist": "magicResist",
    "attack damage": "attackDamage",
    "ability power": "abilityPower",
    "attack speed": "attackSpeed",
    "critical strike chance": "criticalChance",
    "life steal": "lifesteal",
    "omnivamp": "omnivamp",
    "ability haste": "abilityHaste",
    "move speed": "moveSpeed",
    "movement speed": "moveSpeed",
    "tenacity": "tenacity",
    "armor penetration": "armorPen",
    "lethality": "armorPen",
    "magic penetration": "magicPen",
    "heal and shield power": "healAndShieldPower",
  };

  const out: Record<string, number> = {};
  for (const [, value, , rawLabel] of block.matchAll(STAT_LINE)) {
    const column = LABELS[rawLabel.trim().toLowerCase()];
    if (column) out[column] = Number(value);
  }
  return out;
}

/** Remove as tags de marcação, preservando o texto legível das passivas. */
export function stripMarkup(html: string): string {
  return html
    .replace(/<br\s*\/?>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Nomes de passivas/ativos, sem o bloco de stats. */
export function extractPassiveText(description: string): string {
  const withoutStats = description.replace(/<stats>.*?<\/stats>/s, " ");
  return stripMarkup(withoutStats).slice(0, 4000);
}
