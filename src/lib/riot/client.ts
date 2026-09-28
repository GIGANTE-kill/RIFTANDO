import type {
  AccountDto,
  LeagueEntryDto,
  LeagueListDto,
  MatchDto,
  SummonerDto,
  TimelineDto,
} from "./types";

/**
 * Cliente da API oficial da Riot.
 *
 * A chave é gratuita (developer.riotgames.com). A de desenvolvimento expira a
 * cada 24 h e permite 20 requisições por segundo e 100 a cada 2 minutos; a
 * "personal" não expira. O limitador abaixo respeita os dois tetos — estourar
 * rende 429 e, se repetido, bloqueio da chave.
 */

export class RiotApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class MissingKeyError extends RiotApiError {
  constructor() {
    super(
      401,
      "RIOT_API_KEY não configurada. Gere uma chave em developer.riotgames.com e coloque em .env.local.",
    );
  }
}

export const PLATFORMS = [
  "br1", "na1", "la1", "la2", "euw1", "eun1", "tr1", "ru", "me1",
  "kr", "jp1", "oc1", "ph2", "sg2", "th2", "tw2", "vn2",
] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABEL: Record<Platform, string> = {
  br1: "BR", na1: "NA", la1: "LAN", la2: "LAS", euw1: "EUW", eun1: "EUNE", tr1: "TR",
  ru: "RU", me1: "ME", kr: "KR", jp1: "JP", oc1: "OCE", ph2: "PH", sg2: "SG", th2: "TH",
  tw2: "TW", vn2: "VN",
};

export function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value);
}

/** Match-V5 é servida por região, não por servidor. */
function regionOf(platform: Platform): "americas" | "europe" | "asia" | "sea" {
  if (["br1", "na1", "la1", "la2"].includes(platform)) return "americas";
  if (["euw1", "eun1", "tr1", "ru", "me1"].includes(platform)) return "europe";
  if (["kr", "jp1"].includes(platform)) return "asia";
  return "sea";
}

/** Account-V1 não existe em "sea": contas do sudeste asiático ficam em "asia". */
function accountRegionOf(platform: Platform) {
  const region = regionOf(platform);
  return region === "sea" ? "asia" : region;
}

/** "BR1_3012345678" → "br1" */
export function platformOfMatch(matchId: string): Platform | null {
  const prefix = matchId.split("_")[0]?.toLowerCase();
  return prefix && isPlatform(prefix) ? prefix : null;
}

/* ------------------------------------------------------------ limitador */

type Window = { limit: number; ms: number; stamps: number[] };

// singleton: em dev o Next recarrega módulos, e cada cópia teria o seu contador
const globalForRiot = globalThis as unknown as { riotWindows?: Window[] };
const windows: Window[] = (globalForRiot.riotWindows ??= [
  { limit: Number(process.env.RIOT_RATE_PER_SECOND ?? 18), ms: 1_000, stamps: [] },
  { limit: Number(process.env.RIOT_RATE_PER_2MIN ?? 95), ms: 120_000, stamps: [] },
]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function acquire() {
  for (;;) {
    const now = Date.now();
    let wait = 0;
    for (const w of windows) {
      w.stamps = w.stamps.filter((t) => now - t < w.ms);
      if (w.stamps.length >= w.limit) wait = Math.max(wait, w.ms - (now - w.stamps[0]) + 25);
    }
    if (wait === 0) {
      for (const w of windows) w.stamps.push(now);
      return;
    }
    await sleep(wait);
  }
}

/* ------------------------------------------------------------ requisição */

export function hasRiotKey() {
  return Boolean(process.env.RIOT_API_KEY);
}

async function riot<T>(host: string, path: string, attempt = 0): Promise<T | null> {
  const key = process.env.RIOT_API_KEY;
  if (!key) throw new MissingKeyError();

  await acquire();
  const res = await fetch(`https://${host}.api.riotgames.com${path}`, {
    headers: { "X-Riot-Token": key },
    cache: "no-store",
  });

  if (res.status === 404) return null;
  if (res.status === 429 && attempt < 3) {
    const retry = Number(res.headers.get("Retry-After") ?? 5);
    await sleep(retry * 1000);
    return riot<T>(host, path, attempt + 1);
  }
  if (res.status >= 500 && attempt < 2) {
    await sleep(1000 * (attempt + 1));
    return riot<T>(host, path, attempt + 1);
  }
  if (res.status === 401 || res.status === 403) {
    throw new RiotApiError(
      res.status,
      "A Riot recusou a chave (expirada ou inválida). Chaves de desenvolvimento valem 24 h — gere outra em developer.riotgames.com.",
    );
  }
  if (!res.ok) throw new RiotApiError(res.status, `API da Riot respondeu ${res.status} em ${path}`);
  return (await res.json()) as T;
}

/* ------------------------------------------------------------ endpoints */

export const riotApi = {
  accountByRiotId(platform: Platform, gameName: string, tagLine: string) {
    return riot<AccountDto>(
      accountRegionOf(platform),
      `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    );
  },
  accountByPuuid(platform: Platform, puuid: string) {
    return riot<AccountDto>(accountRegionOf(platform), `/riot/account/v1/accounts/by-puuid/${puuid}`);
  },
  summonerByPuuid(platform: Platform, puuid: string) {
    return riot<SummonerDto>(platform, `/lol/summoner/v4/summoners/by-puuid/${puuid}`);
  },
  leagueEntries(platform: Platform, puuid: string) {
    return riot<LeagueEntryDto[]>(platform, `/lol/league/v4/entries/by-puuid/${puuid}`);
  },
  apexLeague(platform: Platform, tier: "challenger" | "grandmaster" | "master") {
    return riot<LeagueListDto>(
      platform,
      `/lol/league/v4/${tier}leagues/by-queue/RANKED_SOLO_5x5`,
    );
  },
  matchIds(
    platform: Platform,
    puuid: string,
    { count = 20, queue, startTime }: { count?: number; queue?: number; startTime?: number } = {},
  ) {
    const params = new URLSearchParams({ count: String(count) });
    if (queue) params.set("queue", String(queue));
    if (startTime) params.set("startTime", String(startTime));
    return riot<string[]>(regionOf(platform), `/lol/match/v5/matches/by-puuid/${puuid}/ids?${params}`);
  },
  match(platform: Platform, matchId: string) {
    return riot<MatchDto>(regionOf(platform), `/lol/match/v5/matches/${matchId}`);
  },
  timeline(platform: Platform, matchId: string) {
    return riot<TimelineDto>(regionOf(platform), `/lol/match/v5/matches/${matchId}/timeline`);
  },
};

/** Fila ranqueada solo/duo — a única com rotas confiáveis e jogo sério. */
export const RANKED_SOLO = 420;
