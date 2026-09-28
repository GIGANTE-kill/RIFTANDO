// Sem "server-only": estas queries também rodam nos scripts de linha de comando,
// e aquele pacote lança fora do bundler do Next. O `import { db }` já é a
// barreira real — nenhum Client Component consegue resolvê-lo.
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  patches,
  champions,
  championPatchStats,
  championTags,
  items,
  itemPatchStats,
  itemTags,
  tags,
  counterRules,
  matchupTagRules,
  championMatchupOverrides,
} from "@/db/schema";
import type { ChampionRef, ItemRef } from "@/engine/types";
import type { CounterRuleRef } from "@/engine/itemization";
import type { MatchupTagRuleRef, MatchupOverrideRef } from "@/engine/matchup";
import type { StatsPayload } from "@/engine/stats";
import { getStatsPayload } from "./matches";

export type CatalogPayload = {
  patch: string;
  champions: ChampionRef[];
  items: ItemRef[];
  rules: CounterRuleRef[];
  matchupRules: MatchupTagRuleRef[];
  matchupOverrides: MatchupOverrideRef[];
  /** partidas reais coletadas com `npm run crawl` — ausente sem coleta */
  stats: StatsPayload | null;
};

/**
 * Carrega o patch atual inteiro de uma vez. São ~218 itens e ~173 campeões:
 * cabe folgado num payload de Server Component, e com tudo no cliente o motor
 * recalcula a cada clique sem round-trip.
 */
export async function getCatalog(): Promise<CatalogPayload | null> {
  const [patch] = await db.select().from(patches).where(eq(patches.isCurrent, true)).limit(1);
  if (!patch) return null;

  const [
    championRows,
    championTagRows,
    itemRows,
    itemTagRows,
    ruleRows,
    matchupRows,
    overrideRows,
    stats,
  ] = await Promise.all([
    db
      .select({ champion: champions, stats: championPatchStats })
      .from(champions)
      .innerJoin(
        championPatchStats,
        and(
          eq(championPatchStats.championId, champions.id),
          eq(championPatchStats.patchId, patch.id),
        ),
      )
      .orderBy(asc(champions.name)),
    db
      .select({ championId: championTags.championId, slug: tags.slug, weight: championTags.weight })
      .from(championTags)
      .innerJoin(tags, eq(tags.id, championTags.tagId)),
    db
      .select({ item: items, stats: itemPatchStats })
      .from(items)
      .innerJoin(
        itemPatchStats,
        and(eq(itemPatchStats.itemId, items.id), eq(itemPatchStats.patchId, patch.id)),
      )
      .orderBy(asc(items.name)),
    db
      .select({ itemId: itemTags.itemId, slug: tags.slug })
      .from(itemTags)
      .innerJoin(tags, eq(tags.id, itemTags.tagId)),
    db.select().from(counterRules).where(eq(counterRules.isActive, true)),
    db.select().from(matchupTagRules).where(eq(matchupTagRules.isActive, true)),
    db.select().from(championMatchupOverrides),
    // a estatística é opcional: sem as tabelas de partida (banco antigo) o
    // motor segue só com as regras
    getStatsPayload(patch.version).catch(() => null),
  ]);

  const championTagMap = new Map<string, { slug: string; weight: number }[]>();
  for (const row of championTagRows) {
    const list = championTagMap.get(row.championId) ?? [];
    list.push({ slug: row.slug, weight: row.weight });
    championTagMap.set(row.championId, list);
  }

  const itemTagMap = new Map<number, string[]>();
  for (const row of itemTagRows) {
    const list = itemTagMap.get(row.itemId) ?? [];
    list.push(row.slug);
    itemTagMap.set(row.itemId, list);
  }

  return {
    patch: patch.version,
    champions: championRows.map(({ champion, stats }) => ({
      id: champion.id,
      riotId: champion.riotId,
      name: champion.name,
      iconUrl: champion.iconUrl,
      attackType: champion.attackType,
      attackRange: stats.attackRange,
      classes: champion.classes,
      positions: champion.positions,
      difficulty: champion.difficulty,
      // a coluna aceita TRUE/NONE (herdado das habilidades); para o campeão
      // inteiro só esses três fazem sentido
      officialDamageType:
        champion.officialDamageType === "PHYSICAL" ||
        champion.officialDamageType === "MAGIC" ||
        champion.officialDamageType === "MIXED"
          ? champion.officialDamageType
          : null,
      playstyle: champion.playstyle,
      tags: (championTagMap.get(champion.id) ?? []).sort((a, b) => b.weight - a.weight),
      base: {
        hp: stats.hp,
        hpPerLevel: stats.hpPerLevel,
        armor: stats.armor,
        armorPerLevel: stats.armorPerLevel,
        magicResist: stats.magicResist,
        mrPerLevel: stats.mrPerLevel,
        attackDamage: stats.attackDamage,
        adPerLevel: stats.adPerLevel,
      },
    })),
    items: itemRows.map(({ item, stats }) => ({
      id: item.id,
      name: item.name,
      iconUrl: item.iconUrl,
      totalGold: stats.totalGold,
      isLegendary: item.isLegendary,
      buildsFrom: item.buildsFrom,
      buildsInto: item.buildsInto,
      categories: item.categories,
      requiredChampion: item.requiredChampion,
      passiveText: stats.passiveText,
      tags: itemTagMap.get(item.id) ?? [],
      stats: {
        health: stats.health,
        armor: stats.armor,
        magicResist: stats.magicResist,
        attackDamage: stats.attackDamage,
        abilityPower: stats.abilityPower,
        attackSpeed: stats.attackSpeed,
        criticalChance: stats.criticalChance,
        lifesteal: stats.lifesteal,
        omnivamp: stats.omnivamp,
        abilityHaste: stats.abilityHaste,
        moveSpeed: stats.moveSpeed,
        tenacity: stats.tenacity,
        armorPen: stats.armorPen,
        magicPen: stats.magicPen,
        healAndShieldPower: stats.healAndShieldPower,
      },
    })),
    rules: ruleRows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      priority: r.priority,
      condition: r.condition,
      recommendTagSlugs: r.recommendTagSlugs,
      recommendItemIds: r.recommendItemIds,
      excludeItemIds: r.excludeItemIds,
      explanation: r.explanation,
    })),
    matchupRules: matchupRows.map((r) => ({
      id: r.id,
      selfTagSlug: r.selfTagSlug,
      enemyTagSlug: r.enemyTagSlug,
      advantage: r.advantage,
      guideline: r.guideline,
      phase: r.phase,
    })),
    matchupOverrides: overrideRows.map((o) => ({
      selfChampionId: o.selfChampionId,
      enemyChampionId: o.enemyChampionId,
      advantage: o.advantage,
      guideline: o.guideline,
    })),
    stats,
  };
}

/**
 * `getCatalog` que nunca derruba a página: sem banco (deploy sem DATABASE_URL,
 * servidor fora do ar, tabelas não criadas) a tela explica o que falta em vez
 * de um erro 500 genérico — em produção o Next esconde a mensagem do erro.
 */
export async function loadCatalog(): Promise<
  { payload: CatalogPayload | null; error: null } | { payload: null; error: DatabaseProblem }
> {
  try {
    return { payload: await getCatalog(), error: null };
  } catch (e) {
    console.error("[riftando] banco indisponível:", e);
    return { payload: null, error: classifyDatabaseError(e) };
  }
}

export type DatabaseProblem = "NOT_CONFIGURED" | "NO_TABLES" | "AUTH" | "UNREACHABLE" | "UNKNOWN";

/**
 * O que deu errado, sem expor SQL nem URL para quem visita o site. O Drizzle
 * embrulha o erro do Postgres em `cause`; o código SQLSTATE diz o motivo.
 */
export function classifyDatabaseError(e: unknown): DatabaseProblem {
  if (e instanceof Error && e.message.startsWith("Banco não configurado")) return "NOT_CONFIGURED";
  const chain: { code?: string; message?: string }[] = [];
  for (let cur: unknown = e; cur && chain.length < 5; cur = (cur as { cause?: unknown }).cause)
    chain.push(cur as { code?: string; message?: string });
  const codes = chain.map((c) => c.code);
  const text = chain.map((c) => c.message ?? "").join(" ");
  if (codes.includes("42P01") || /does not exist/.test(text)) return "NO_TABLES";
  if (codes.includes("28P01") || codes.includes("28000") || /password|authentication/i.test(text))
    return "AUTH";
  if (codes.some((c) => c && /^(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET)$/.test(c)) || /connect/i.test(text))
    return "UNREACHABLE";
  return "UNKNOWN";
}
