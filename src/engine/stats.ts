/**
 * Estatística de partidas reais, coletadas pela API da Riot (`npm run crawl`).
 *
 * O motor de regras diz *por que* um confronto é bom; a estatística diz *se*
 * ele é bom na prática. Os dois juntos são mais fortes que cada um sozinho — e
 * a estatística nunca decide sozinha com amostra pequena.
 */
import type { Role } from "./match";

export type RoleStat = { championId: string; role: Role; games: number; wins: number };

export type MatchupStat = {
  championId: string;
  opponentId: string;
  role: Role;
  games: number;
  wins: number;
};

export type StatsPayload = {
  /** "16.17" — só entram partidas deste patch */
  patch: string;
  matches: number;
  roleStats: RoleStat[];
  matchups: MatchupStat[];
  /** quantas partidas tiveram o campeão banido */
  bans: { championId: string; count: number }[];
};

/**
 * Taxa de vitória puxada para 50% conforme a amostra é pequena.
 *
 * Com k partidas "fantasmas" empatadas somadas, 5 vitórias em 6 partidas vira
 * ~53% em vez de 83%. É a mesma ideia do "rating bayesiano" de lojas de app:
 * ninguém confia numa nota 5 com uma avaliação só.
 */
export function shrunkWinRate(wins: number, games: number, k: number): number {
  return (wins + 0.5 * k) / (games + k);
}

export type RateReading = {
  /** taxa crua, 0..1 */
  raw: number;
  /** taxa corrigida pela amostra, 0..1 */
  adjusted: number;
  games: number;
};

export type StatsIndex = {
  patch: string;
  matches: number;
  role(championId: string, role: Role): RateReading | null;
  matchup(championId: string, opponentId: string, role: Role): RateReading | null;
  /** 0..1 — em quantas partidas o campeão aparece nesta rota */
  pickRate(championId: string, role: Role): number;
  banRate(championId: string): number;
};

/** Amostra mínima para exibir um número — abaixo disso é ruído. */
export const MIN_ROLE_GAMES = 30;
export const MIN_MATCHUP_GAMES = 12;

export function buildStatsIndex(payload: StatsPayload): StatsIndex {
  const roles = new Map(payload.roleStats.map((r) => [`${r.championId}|${r.role}`, r]));
  const matchups = new Map(
    payload.matchups.map((m) => [`${m.championId}|${m.opponentId}|${m.role}`, m]),
  );
  const bans = new Map(payload.bans.map((b) => [b.championId, b.count]));

  const read = (wins: number, games: number, k: number): RateReading => ({
    raw: games ? wins / games : 0.5,
    adjusted: shrunkWinRate(wins, games, k),
    games,
  });

  return {
    patch: payload.patch,
    matches: payload.matches,
    role(championId, role) {
      const r = roles.get(`${championId}|${role}`);
      return r && r.games >= MIN_ROLE_GAMES ? read(r.wins, r.games, 100) : null;
    },
    matchup(championId, opponentId, role) {
      const m = matchups.get(`${championId}|${opponentId}|${role}`);
      return m && m.games >= MIN_MATCHUP_GAMES ? read(m.wins, m.games, 40) : null;
    },
    pickRate(championId, role) {
      const r = roles.get(`${championId}|${role}`);
      return r && payload.matches ? r.games / payload.matches : 0;
    },
    banRate(championId) {
      return payload.matches ? (bans.get(championId) ?? 0) / payload.matches : 0;
    },
  };
}

export const formatRate = (rate: number) =>
  `${(rate * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

export const formatGames = (games: number) => games.toLocaleString("pt-BR");

/** "1 partida", "1.204 partidas" */
export const formatMatches = (games: number) =>
  `${formatGames(games)} ${games === 1 ? "partida" : "partidas"}`;
