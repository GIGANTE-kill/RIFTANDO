import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { laneRoleEnum } from "./champions";
import type { MatchDto, TimelineDto } from "@/lib/riot/types";

/**
 * Partida baixada da API da Riot (Match-V5). Partida terminada não muda nunca,
 * então o JSON é guardado inteiro e baixado uma vez só — o limite de
 * requisições da chave é o recurso mais escasso do projeto.
 */
export const riotMatches = pgTable(
  "riot_matches",
  {
    id: text("id").primaryKey(), // "BR1_3012345678"
    platform: text("platform").notNull(), // "br1"
    /** "16.17" — major.minor do gameVersion */
    patch: text("patch").notNull(),
    queueId: integer("queue_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    durationSec: integer("duration_sec").notNull(),
    /** ids do Data Dragon dos campeões banidos pelos dois times */
    bans: text("bans").array().notNull().default([]),
    data: jsonb("data").$type<MatchDto>().notNull(),
    /** a linha do tempo só é baixada quando alguém pede a revisão */
    timeline: jsonb("timeline").$type<TimelineDto>(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("riot_matches_patch_queue_idx").on(t.patch, t.queueId)],
);

/**
 * Um jogador numa partida — a linha que a estatística agrega. Desnormalizada
 * de propósito: patch, fila e oponente de rota ficam na própria linha para
 * que "taxa de vitória da Ahri no meio contra Zed" seja um GROUP BY sem JOIN.
 */
export const matchParticipants = pgTable(
  "match_participants",
  {
    matchId: text("match_id")
      .notNull()
      .references(() => riotMatches.id, { onDelete: "cascade" }),
    puuid: text("puuid").notNull(),
    championId: text("champion_id").notNull(),
    role: laneRoleEnum("role"),
    /** quem jogou a mesma rota do outro lado */
    opponentChampionId: text("opponent_champion_id"),
    win: boolean("win").notNull(),
    patch: text("patch").notNull(),
    queueId: integer("queue_id").notNull(),
    kills: integer("kills").notNull(),
    deaths: integer("deaths").notNull(),
    assists: integer("assists").notNull(),
    cs: integer("cs").notNull(),
    goldEarned: integer("gold_earned").notNull(),
    /** itens finais, sem bugiganga */
    items: integer("items").array().notNull().default([]),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.matchId, t.puuid] }),
    index("mp_stats_idx").on(t.patch, t.queueId, t.championId, t.role),
    index("mp_puuid_idx").on(t.puuid, t.startedAt),
  ],
);

/** Conta Riot já resolvida — evita repetir a busca por nome#tag. */
export const riotAccounts = pgTable("riot_accounts", {
  puuid: text("puuid").primaryKey(),
  gameName: text("game_name").notNull(),
  tagLine: text("tag_line").notNull(),
  platform: text("platform").notNull(),
  profileIconId: integer("profile_icon_id"),
  summonerLevel: integer("summoner_level"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type RiotMatch = typeof riotMatches.$inferSelect;
export type MatchParticipant = typeof matchParticipants.$inferSelect;
