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

export type CatalogPayload = {
  patch: string;
  champions: ChampionRef[];
  items: ItemRef[];
  rules: CounterRuleRef[];
  matchupRules: MatchupTagRuleRef[];
  matchupOverrides: MatchupOverrideRef[];
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
  };
}
