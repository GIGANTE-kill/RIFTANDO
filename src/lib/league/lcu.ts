import { readFile } from "node:fs/promises";
import path from "node:path";
import { localJson } from "./local-https";
import type {
  ChampSelectMember,
  ChampSelectSnapshot,
  ClientIdentity,
} from "@/engine/league-sync";

/**
 * LCU: a API local do cliente do LoL (a janela do lobby, não o jogo).
 *
 * Enquanto o cliente está aberto ele grava um `lockfile` na pasta de
 * instalação com a porta e a senha da sessão:
 *   LeagueClient:<pid>:<porta>:<senha>:https
 * Com isso dá para ler a fase atual, a seleção de campeões e quem está logado.
 *
 * Política da Riot: ferramentas de seleção podem ler picks e bans, mas não
 * revelar quem são os jogadores. Aqui só trafegam ids de campeão.
 */

const DEFAULT_PATHS = [
  "C:\\Riot Games\\League of Legends",
  "D:\\Riot Games\\League of Legends",
  "/Applications/League of Legends.app/Contents/LoL",
];

type Credentials = { port: number; auth: string };

async function readCredentials(): Promise<Credentials | null> {
  const candidates = process.env.LEAGUE_PATH ? [process.env.LEAGUE_PATH] : DEFAULT_PATHS;
  for (const dir of candidates) {
    try {
      const content = await readFile(path.join(dir, "lockfile"), "utf8");
      const [, , port, password] = content.trim().split(":");
      if (!port || !password) continue;
      return {
        port: Number(port),
        auth: "Basic " + Buffer.from(`riot:${password}`).toString("base64"),
      };
    } catch {
      /* cliente fechado ou instalado em outra pasta */
    }
  }
  return null;
}

async function lcu<T>(creds: Credentials, route: string): Promise<T> {
  return localJson<T>(creds.port, route, { headers: { Authorization: creds.auth } });
}

/** Fases do cliente que interessam ao Riftando. */
export type GameflowPhase =
  | "None"
  | "Lobby"
  | "Matchmaking"
  | "ReadyCheck"
  | "ChampSelect"
  | "GameStart"
  | "InProgress"
  | "Reconnect"
  | "WaitingForStats"
  | "PreEndOfGame"
  | "EndOfGame"
  | string;

export type ClientState = {
  phase: GameflowPhase;
  identity: ClientIdentity | null;
  champSelect: ChampSelectSnapshot | null;
  /** id da última partida terminada, para a revisão pós-jogo */
  lastGameId: number | null;
};

const REGION_TO_PLATFORM: Record<string, string> = {
  BR: "br1",
  NA: "na1",
  LAN: "la1",
  LAS: "la2",
  EUW: "euw1",
  EUNE: "eun1",
  TR: "tr1",
  RU: "ru",
  KR: "kr",
  JP: "jp1",
  OCE: "oc1",
  PH: "ph2",
  SG: "sg2",
  TH: "th2",
  TW: "tw2",
  VN: "vn2",
  ME: "me1",
};

type RawChampSelect = {
  localPlayerCellId: number;
  myTeam: { cellId: number; championId: number; assignedPosition: string }[];
  theirTeam: { cellId: number; championId: number; assignedPosition: string }[];
  bans?: { myTeamBans?: number[]; theirTeamBans?: number[] };
  actions?: { type: string; championId: number; completed: boolean }[][];
  timer?: { phase?: string };
};

export function normalizeChampSelect(raw: RawChampSelect): ChampSelectSnapshot {
  const member = (m: RawChampSelect["myTeam"][number]): ChampSelectMember => ({
    cellId: m.cellId,
    championId: m.championId ?? 0,
    assignedPosition: m.assignedPosition ?? "",
  });
  // o campo `bans` vem vazio em algumas filas; as ações de banimento concluídas
  // são a fonte que sempre existe
  const fromActions = (raw.actions ?? [])
    .flat()
    .filter((a) => a.type === "ban" && a.completed && a.championId > 0)
    .map((a) => a.championId);
  const fromBans = [...(raw.bans?.myTeamBans ?? []), ...(raw.bans?.theirTeamBans ?? [])].filter(
    (id) => id > 0,
  );

  return {
    localPlayerCellId: raw.localPlayerCellId,
    myTeam: raw.myTeam.map(member),
    theirTeam: raw.theirTeam.map(member),
    bans: [...new Set([...fromActions, ...fromBans])],
    timerPhase: raw.timer?.phase ?? "",
  };
}

/**
 * Estado do cliente, ou `null` se ele não está aberto.
 *
 * `RIFTANDO_LCU_FIXTURE` aponta para um JSON `{ phase, champSelect, identity }`
 * gravado — para desenvolver sem abrir o LoL.
 */
export async function readClientState(): Promise<ClientState | null> {
  const fixture = process.env.RIFTANDO_LCU_FIXTURE;
  if (fixture) {
    try {
      const raw = JSON.parse(await readFile(fixture, "utf8"));
      return {
        phase: raw.phase ?? "None",
        identity: raw.identity ?? null,
        champSelect: raw.champSelect ? normalizeChampSelect(raw.champSelect) : null,
        lastGameId: raw.lastGameId ?? null,
      };
    } catch {
      return null;
    }
  }

  const creds = await readCredentials();
  if (!creds) return null;

  let phase: GameflowPhase;
  try {
    phase = await lcu<GameflowPhase>(creds, "/lol-gameflow/v1/gameflow-phase");
  } catch {
    // lockfile antigo de um cliente que já fechou
    return null;
  }

  const [identity, champSelect, lastGameId] = await Promise.all([
    readIdentity(creds),
    phase === "ChampSelect"
      ? lcu<RawChampSelect>(creds, "/lol-champ-select/v1/session")
          .then(normalizeChampSelect)
          .catch(() => null)
      : Promise.resolve(null),
    POST_GAME_PHASES.has(phase) ? readLastGameId(creds)
      : Promise.resolve(null),
  ]);

  return { phase, identity, champSelect, lastGameId };
}

// fora da seleção e da partida, a última partida é a que vale revisar
const POST_GAME_PHASES = new Set(["None", "Lobby", "WaitingForStats", "PreEndOfGame", "EndOfGame"]);

// quem está logado não muda durante a sessão do cliente: uma leitura basta
let identityCache: { port: number; value: ClientIdentity } | null = null;

async function readIdentity(creds: Credentials): Promise<ClientIdentity | null> {
  if (identityCache?.port === creds.port) return identityCache.value;
  try {
    const [summoner, region] = await Promise.all([
      lcu<{ puuid: string; gameName: string; tagLine: string }>(
        creds,
        "/lol-summoner/v1/current-summoner",
      ),
      lcu<{ region: string }>(creds, "/riotclient/region-locale").catch(() => null),
    ]);
    const value: ClientIdentity = {
      puuid: summoner.puuid,
      gameName: summoner.gameName,
      tagLine: summoner.tagLine,
      platform: region ? (REGION_TO_PLATFORM[region.region.toUpperCase()] ?? null) : null,
    };
    identityCache = { port: creds.port, value };
    return value;
  } catch {
    return null;
  }
}

async function readLastGameId(creds: Credentials): Promise<number | null> {
  try {
    const eog = await lcu<{ gameId?: number }>(creds, "/lol-end-of-game/v1/eog-stats-block");
    if (eog.gameId) return eog.gameId;
  } catch {
    /* só existe logo depois da partida */
  }
  try {
    const history = await lcu<{ games?: { games?: { gameId: number }[] } }>(
      creds,
      "/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=1",
    );
    return history.games?.games?.[0]?.gameId ?? null;
  } catch {
    return null;
  }
}
