import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { champions, matchParticipants, riotAccounts, riotMatches } from "@/db/schema";
import { RANKED_SOLO, riotApi, platformOfMatch, type Platform } from "@/lib/riot/client";
import type { MatchDto, ParticipantDto } from "@/lib/riot/types";
import type { Role } from "@/engine/match";
import type { StatsPayload } from "@/engine/stats";

/** "16.17.712.3456" → "16.17" */
export const patchOf = (gameVersion: string) => gameVersion.split(".").slice(0, 2).join(".");

const POSITION: Record<string, Role> = {
  TOP: "TOP",
  JUNGLE: "JUNGLE",
  MIDDLE: "MID",
  BOTTOM: "ADC",
  UTILITY: "SUPPORT",
};

export const roleOfParticipant = (p: Pick<ParticipantDto, "teamPosition">): Role | null =>
  POSITION[p.teamPosition] ?? null;

export const finalItems = (p: ParticipantDto) =>
  [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5].filter((id) => id > 0);

/** Riot id numérico → id do Data Dragon, para os bans (que só vêm numéricos). */
let championKeyCache: Map<number, string> | null = null;
async function championKeys() {
  if (championKeyCache) return championKeyCache;
  const rows = await db.select({ id: champions.id, riotId: champions.riotId }).from(champions);
  championKeyCache = new Map(rows.map((r) => [r.riotId, r.id]));
  return championKeyCache;
}

/**
 * Guarda a partida e uma linha por jogador. Idempotente: baixar a mesma
 * partida duas vezes não duplica nada.
 */
export async function storeMatch(match: MatchDto) {
  const info = match.info;
  const patch = patchOf(info.gameVersion);
  const startedAt = new Date(info.gameStartTimestamp ?? info.gameCreation);
  const keys = await championKeys();
  const bans = info.teams
    .flatMap((t) => t.bans.map((b) => keys.get(b.championId)))
    .filter((id): id is string => Boolean(id));

  await db
    .insert(riotMatches)
    .values({
      id: match.metadata.matchId,
      platform: info.platformId.toLowerCase(),
      patch,
      queueId: info.queueId,
      startedAt,
      durationSec: info.gameDuration,
      bans,
      data: match,
    })
    .onConflictDoNothing();

  const rows = info.participants.map((p) => {
    const role = roleOfParticipant(p);
    const opponent = role
      ? info.participants.find(
          (o) => o.teamId !== p.teamId && roleOfParticipant(o) === role,
        )
      : undefined;
    return {
      matchId: match.metadata.matchId,
      puuid: p.puuid,
      championId: p.championName,
      role,
      opponentChampionId: opponent?.championName ?? null,
      win: p.win,
      patch,
      queueId: info.queueId,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      cs: p.totalMinionsKilled + p.neutralMinionsKilled,
      goldEarned: p.goldEarned,
      items: finalItems(p),
      startedAt,
    };
  });
  await db.insert(matchParticipants).values(rows).onConflictDoNothing();
}

/** Partida do banco; baixa da Riot só se ainda não tiver. */
export async function getMatch(matchId: string, { withTimeline = false } = {}) {
  const platform = platformOfMatch(matchId);
  if (!platform) return null;

  let [row] = await db.select().from(riotMatches).where(eq(riotMatches.id, matchId)).limit(1);
  if (!row) {
    const match = await riotApi.match(platform, matchId);
    if (!match) return null;
    await storeMatch(match);
    [row] = await db.select().from(riotMatches).where(eq(riotMatches.id, matchId)).limit(1);
  }

  if (withTimeline && !row.timeline) {
    const timeline = await riotApi.timeline(platform, matchId);
    if (timeline) {
      await db.update(riotMatches).set({ timeline }).where(eq(riotMatches.id, matchId));
      row = { ...row, timeline };
    }
  }
  return row;
}

/** Quais destes ids ainda não estão no banco. */
export async function missingMatchIds(ids: string[]) {
  if (!ids.length) return [];
  const have = await db
    .select({ id: riotMatches.id })
    .from(riotMatches)
    .where(inArray(riotMatches.id, ids));
  const known = new Set(have.map((r) => r.id));
  return ids.filter((id) => !known.has(id));
}

/** As partidas mais recentes do jogador, baixando só as que faltam. */
export async function getRecentMatches(platform: Platform, puuid: string, count = 10) {
  const ids = (await riotApi.matchIds(platform, puuid, { count })) ?? [];
  for (const id of await missingMatchIds(ids)) {
    const match = await riotApi.match(platform, id);
    if (match) await storeMatch(match);
  }
  if (!ids.length) return [];
  const rows = await db
    .select()
    .from(riotMatches)
    .where(inArray(riotMatches.id, ids))
    .orderBy(desc(riotMatches.startedAt));
  return rows;
}

export async function resolveAccount(platform: Platform, gameName: string, tagLine: string) {
  const account = await riotApi.accountByRiotId(platform, gameName, tagLine);
  if (!account) return null;
  const summoner = await riotApi.summonerByPuuid(platform, account.puuid);
  const values = {
    puuid: account.puuid,
    gameName: account.gameName,
    tagLine: account.tagLine,
    platform,
    profileIconId: summoner?.profileIconId ?? null,
    summonerLevel: summoner?.summonerLevel ?? null,
    updatedAt: new Date(),
  };
  await db
    .insert(riotAccounts)
    .values(values)
    .onConflictDoUpdate({ target: riotAccounts.puuid, set: values });
  return values;
}

/* ------------------------------------------------------------ estatística */

const winsSql = sql<number>`sum(case when ${matchParticipants.win} then 1 else 0 end)::int`;
const gamesSql = sql<number>`count(*)::int`;

/**
 * Qual patch tem dados suficientes. No começo de um patch quase não há
 * partidas; aí vale o anterior — e a tela avisa de qual patch é o número.
 */
async function statsPatch(currentPatch: string): Promise<{ patch: string; matches: number } | null> {
  const rows = await db
    .select({ patch: riotMatches.patch, matches: sql<number>`count(*)::int` })
    .from(riotMatches)
    .where(eq(riotMatches.queueId, RANKED_SOLO))
    .groupBy(riotMatches.patch);
  if (!rows.length) return null;

  const current = rows.find((r) => r.patch === currentPatch);
  if (current && current.matches >= 100) return current;
  // o patch mais recente com dados, comparando major.minor numericamente
  const byVersion = (p: string) => p.split(".").map(Number);
  rows.sort((a, b) => {
    const [a1, a2] = byVersion(a.patch);
    const [b1, b2] = byVersion(b.patch);
    return b1 - a1 || b2 - a2;
  });
  return rows[0];
}

export async function getStatsPayload(currentVersion: string): Promise<StatsPayload | null> {
  const chosen = await statsPatch(patchOf(currentVersion));
  if (!chosen) return null;
  const where = and(
    eq(matchParticipants.patch, chosen.patch),
    eq(matchParticipants.queueId, RANKED_SOLO),
    isNotNull(matchParticipants.role),
  );

  const [roleRows, matchupRows, banRows] = await Promise.all([
    db
      .select({
        championId: matchParticipants.championId,
        role: matchParticipants.role,
        games: gamesSql,
        wins: winsSql,
      })
      .from(matchParticipants)
      .where(where)
      .groupBy(matchParticipants.championId, matchParticipants.role),
    db
      .select({
        championId: matchParticipants.championId,
        opponentId: matchParticipants.opponentChampionId,
        role: matchParticipants.role,
        games: gamesSql,
        wins: winsSql,
      })
      .from(matchParticipants)
      .where(and(where, isNotNull(matchParticipants.opponentChampionId)))
      .groupBy(
        matchParticipants.championId,
        matchParticipants.opponentChampionId,
        matchParticipants.role,
      )
      // confronto visto 2 vezes não informa nada e só engorda o payload
      .having(sql`count(*) >= 3`),
    db
      .select({ bans: riotMatches.bans })
      .from(riotMatches)
      .where(and(eq(riotMatches.patch, chosen.patch), eq(riotMatches.queueId, RANKED_SOLO))),
  ]);

  const banCount = new Map<string, number>();
  for (const { bans } of banRows)
    for (const id of new Set(bans)) banCount.set(id, (banCount.get(id) ?? 0) + 1);

  return {
    patch: chosen.patch,
    matches: chosen.matches,
    roleStats: roleRows.map((r) => ({ ...r, role: r.role! })),
    matchups: matchupRows.map((r) => ({ ...r, role: r.role!, opponentId: r.opponentId! })),
    bans: [...banCount].map(([championId, count]) => ({ championId, count })),
  };
}

/** Itens da build final de um campeão numa rota, com a taxa de vitória de quem os tinha. */
export async function getItemStats(patch: string, championId: string, role: Role) {
  const rows = await db
    .select({ items: matchParticipants.items, win: matchParticipants.win })
    .from(matchParticipants)
    .where(
      and(
        eq(matchParticipants.patch, patch),
        eq(matchParticipants.queueId, RANKED_SOLO),
        eq(matchParticipants.championId, championId),
        eq(matchParticipants.role, role),
      ),
    );
  const count = new Map<number, { games: number; wins: number }>();
  for (const r of rows) {
    for (const id of new Set(r.items)) {
      const entry = count.get(id) ?? { games: 0, wins: 0 };
      entry.games++;
      if (r.win) entry.wins++;
      count.set(id, entry);
    }
  }
  return { total: rows.length, items: [...count].map(([itemId, s]) => ({ itemId, ...s })) };
}
