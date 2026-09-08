/**
 * Ingestão de dados estáticos por patch.
 *   npm run sync
 *
 * Fontes:
 *   - Data Dragon (Riot)      → versão do patch, stats e habilidades de campeão,
 *                               stats numéricos de item.
 *   - CommunityDragon         → catálogo completo de itens: categorias oficiais,
 *                               árvore de build, texto das passivas, ícones.
 *
 * Idempotente: PK composta (entidade, patch). Re-rodar no mesmo patch atualiza;
 * num patch novo cria linhas novas e o diff vira um JOIN entre dois patchId.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { eq, sql, notInArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  patches,
  syncRuns,
  champions,
  championPatchStats,
  items,
  itemPatchStats,
  type AbilitySnapshot,
} from "../src/db/schema";
import {
  fetchLatestVersion,
  fetchChampions,
  fetchItemStats,
  DDRAGON_STAT_MAP,
  type DDragonChampion,
} from "../src/lib/sources/ddragon";
import { fetchLanes, guessLanes, type Lane } from "../src/lib/sources/positions";
import {
  fetchItems,
  fetchChampionDetails,
  fetchContentVersion,
  parseStatsFromDescription,
  extractPassiveText,
  championIconUrl,
  championSplashUrl,
  itemIconUrl,
} from "../src/lib/sources/cdragon";

const SPELL_KEYS = ["Q", "W", "E", "R"] as const;

/** <status>Knocked Up</status>, <physicalDamage>, <healing>... */
function parseMarkup(tooltip: string) {
  const markers = [...new Set([...tooltip.matchAll(/<([a-zA-Z]+)>/g)].map((m) => m[1]))];
  const statuses = [
    ...new Set([...tooltip.matchAll(/<status>(.*?)<\/status>/gs)].map((m) => m[1].trim())),
  ];
  const damageTypes: AbilitySnapshot["damageTypes"] = [];
  if (markers.includes("physicalDamage")) damageTypes.push("PHYSICAL");
  if (markers.includes("magicDamage")) damageTypes.push("MAGIC");
  if (markers.includes("trueDamage")) damageTypes.push("TRUE");
  return { markers, statuses, damageTypes };
}

const clean = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/\{\{.*?\}\}/g, " ").replace(/\s+/g, " ").trim();

function snapshotAbilities(c: DDragonChampion): AbilitySnapshot[] {
  const out: AbilitySnapshot[] = [];

  if (c.passive) {
    const { markers, statuses, damageTypes } = parseMarkup(c.passive.description);
    out.push({
      key: "P",
      name: c.passive.name,
      damageTypes,
      markers,
      statuses,
      cooldownByRank: [],
      costByRank: [],
      rangeByRank: [],
      text: clean(c.passive.description).slice(0, 2000),
    });
  }

  c.spells.slice(0, 4).forEach((spell, i) => {
    const source = spell.tooltip || spell.description;
    const { markers, statuses, damageTypes } = parseMarkup(source);
    out.push({
      key: SPELL_KEYS[i],
      name: spell.name,
      damageTypes,
      markers,
      statuses,
      cooldownByRank: spell.cooldown,
      costByRank: spell.cost,
      // 25000 é o sentinela da Riot para "global/sem alcance definido"
      rangeByRank: spell.range.map((r) => (r >= 25000 ? 0 : r)),
      text: clean(source).slice(0, 2000),
    });
  });

  return out;
}

async function ensurePatch(version: string) {
  await db.update(patches).set({ isCurrent: false }).where(eq(patches.isCurrent, true));
  const [row] = await db
    .insert(patches)
    .values({ version, isCurrent: true })
    .onConflictDoUpdate({ target: patches.version, set: { isCurrent: true, syncedAt: new Date() } })
    .returning();
  return row;
}

const DAMAGE_TYPE_MAP: Record<string, "PHYSICAL" | "MAGIC" | "MIXED"> = {
  kPhysical: "PHYSICAL",
  kMagic: "MAGIC",
  kMixed: "MIXED",
};

async function syncChampions(patchId: number, version: string): Promise<number> {
  // inglês para derivar tags, português para mostrar na tela
  const [list, ptList, lanes] = await Promise.all([
    fetchChampions(version, "en_US"),
    fetchChampions(version, "pt_BR").catch(() => []),
    fetchLanes().catch(() => new Map<string, Lane[]>()),
  ]);
  const ptNames = new Map(ptList.map((c) => [c.id, { name: c.name, title: c.title }]));
  const details = await fetchChampionDetails(list.map((c) => Number(c.key)));

  let guessed = 0;
  for (const c of list) {
    const riotId = Number(c.key);
    const s = c.stats;
    const pt = ptNames.get(c.id);
    const detail = details.get(riotId);

    let positions = lanes.get(c.id);
    if (!positions?.length) {
      positions = guessLanes(c.tags);
      guessed++;
    }

    await db
      .insert(champions)
      .values({
        id: c.id,
        riotId,
        name: pt?.name ?? c.name,
        title: pt?.title ?? c.title,
        attackType: (s.attackrange ?? 0) >= 300 ? "RANGED" : "MELEE",
        resource: c.partype || null,
        classes: c.tags,
        positions,
        officialDamageType: detail?.tacticalInfo.damageType
          ? (DAMAGE_TYPE_MAP[detail.tacticalInfo.damageType] ?? null)
          : null,
        difficulty: detail?.tacticalInfo.difficulty ?? null,
        playstyle: detail?.playstyleInfo ?? null,
        iconUrl: championIconUrl(riotId),
        splashUrl: championSplashUrl(riotId),
      })
      .onConflictDoUpdate({
        target: champions.id,
        set: {
          name: pt?.name ?? c.name,
          title: pt?.title ?? c.title,
          classes: c.tags,
          positions,
          officialDamageType: detail?.tacticalInfo.damageType
            ? (DAMAGE_TYPE_MAP[detail.tacticalInfo.damageType] ?? null)
            : null,
          difficulty: detail?.tacticalInfo.difficulty ?? null,
          playstyle: detail?.playstyleInfo ?? null,
          resource: c.partype || null,
          iconUrl: championIconUrl(riotId),
          splashUrl: championSplashUrl(riotId),
        },
      });

    const values = {
      championId: c.id,
      patchId,
      hp: s.hp ?? 0,
      hpPerLevel: s.hpperlevel ?? 0,
      armor: s.armor ?? 0,
      armorPerLevel: s.armorperlevel ?? 0,
      magicResist: s.spellblock ?? 0,
      mrPerLevel: s.spellblockperlevel ?? 0,
      attackDamage: s.attackdamage ?? 0,
      adPerLevel: s.attackdamageperlevel ?? 0,
      attackSpeed: s.attackspeed ?? 0,
      moveSpeed: s.movespeed ?? 0,
      attackRange: s.attackrange ?? 0,
      abilities: snapshotAbilities(c),
    };

    await db
      .insert(championPatchStats)
      .values(values)
      // hotfixes acontecem sem trocar o número do patch → sempre atualiza
      .onConflictDoUpdate({
        target: [championPatchStats.championId, championPatchStats.patchId],
        set: values,
      });
  }

  if (guessed) {
    console.log(`  · ${guessed} campeão(ões) sem rota conhecida: rota estimada pela classe`);
  }
  return list.length;
}

/**
 * O CDragon lista 696 itens "na loja": inclui Arena, Swarm e itens já removidos
 * do jogo (Deathfire Grasp, Prowler's Claw). Recomendar um deles seria um bug
 * grave, então cruzamos com o Data Dragon e ficamos só com Summoner's Rift.
 *
 * Sobram 218 itens — a loja real.
 */
function isSummonersRiftItem(
  item: { id: number; inStore: boolean; name: string },
  dd: Awaited<ReturnType<typeof fetchItemStats>>,
): boolean {
  const d = dd[String(item.id)];
  return (
    Boolean(item.name) &&
    item.inStore &&
    // ids >= 100000 são variantes de outros modos (22xxxx Arena, 32xxxx/44xxxx/77xxxx Swarm)
    item.id < 100000 &&
    Boolean(d) &&
    d.maps["11"] === true &&
    d.inStore !== false &&
    d.gold.purchasable !== false
  );
}

async function syncItems(patchId: number, version: string): Promise<number> {
  const [catalog, ddStats, ptStats] = await Promise.all([
    fetchItems(),
    fetchItemStats(version, "en_US"),
    // só os nomes; as descrições em inglês continuam alimentando o derivador
    fetchItemStats(version, "pt_BR").catch(() => ({}) as Record<string, { name: string }>),
  ]);
  const keep = catalog.filter((it) => isSummonersRiftItem(it, ddStats));
  let count = 0;

  // itens que saíram do jogo desde o último sync (cascata limpa stats e tags)
  const keepIds = keep.map((i) => i.id);
  const removed = await db
    .delete(items)
    .where(notInArray(items.id, keepIds))
    .returning({ id: items.id });
  if (removed.length) console.log(`  · ${removed.length} itens obsoletos removidos`);

  for (const it of keep) {
    const displayName = ptStats[String(it.id)]?.name ?? it.name;

    await db
      .insert(items)
      .values({
        id: it.id,
        name: displayName,
        categories: it.categories,
        buildsFrom: it.from,
        buildsInto: it.to,
        isLegendary: it.to.length === 0 && it.priceTotal >= 2000,
        isPurchasable: it.inStore,
        requiredChampion: it.requiredChampion || null,
        iconUrl: itemIconUrl(it.iconPath),
      })
      .onConflictDoUpdate({
        target: items.id,
        set: {
          name: displayName,
          categories: it.categories,
          buildsFrom: it.from,
          buildsInto: it.to,
          isLegendary: it.to.length === 0 && it.priceTotal >= 2000,
          isPurchasable: it.inStore,
          iconUrl: itemIconUrl(it.iconPath),
        },
      });

    // stats numéricos: DDragon (chaves legadas) + o que só existe no texto
    const stats: Record<string, number> = {};
    for (const [key, value] of Object.entries(ddStats[String(it.id)]?.stats ?? {})) {
      const mapped = DDRAGON_STAT_MAP[key];
      if (mapped) stats[mapped.column] = (stats[mapped.column] ?? 0) + value * mapped.scale;
    }
    for (const [column, value] of Object.entries(parseStatsFromDescription(it.description))) {
      stats[column] = Math.max(stats[column] ?? 0, value);
    }

    const values = {
      itemId: it.id,
      patchId,
      totalGold: it.priceTotal,
      health: stats.health ?? 0,
      armor: stats.armor ?? 0,
      magicResist: stats.magicResist ?? 0,
      attackDamage: stats.attackDamage ?? 0,
      abilityPower: stats.abilityPower ?? 0,
      attackSpeed: stats.attackSpeed ?? 0,
      criticalChance: stats.criticalChance ?? 0,
      lifesteal: stats.lifesteal ?? 0,
      omnivamp: stats.omnivamp ?? 0,
      abilityHaste: stats.abilityHaste ?? 0,
      moveSpeed: stats.moveSpeed ?? 0,
      tenacity: stats.tenacity ?? 0,
      armorPen: stats.armorPen ?? 0,
      magicPen: stats.magicPen ?? 0,
      healAndShieldPower: stats.healAndShieldPower ?? 0,
      passiveText: extractPassiveText(it.description),
      raw: it as unknown as object,
    };

    await db
      .insert(itemPatchStats)
      .values(values)
      .onConflictDoUpdate({
        target: [itemPatchStats.itemId, itemPatchStats.patchId],
        set: values,
      });
    count++;
  }
  return count;
}

async function main() {
  const version = await fetchLatestVersion();
  const contentVersion = await fetchContentVersion().catch(() => "desconhecida");
  const patch = await ensurePatch(version);
  console.log(`▶ Data Dragon ${version} · CommunityDragon ${contentVersion} (patch id ${patch.id})`);

  const jobs = [
    ["ddragon:champions", syncChampions],
    ["cdragon:items", syncItems],
  ] as const;

  for (const [source, run] of jobs) {
    const started = Date.now();
    try {
      const changedRows = await run(patch.id, version);
      await db.insert(syncRuns).values({ patchId: patch.id, source, status: "ok", changedRows });
      console.log(`  ✔ ${source}: ${changedRows} registros (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    } catch (error) {
      await db
        .insert(syncRuns)
        .values({ patchId: patch.id, source, status: "failed", error: String(error) });
      console.error(`  ✖ ${source}:`, error);
      process.exitCode = 1;
    }
  }

  const [{ champs }] = await db
    .select({ champs: sql<number>`count(*)::int` })
    .from(championPatchStats)
    .where(eq(championPatchStats.patchId, patch.id));
  console.log(`▶ Patch ${patch.version}: ${champs} campeões prontos. Rode \`npm run tags:derive\`.`);
  process.exit(process.exitCode ?? 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
