import { readFile } from "node:fs/promises";
import { localJson } from "./local-https";
import type { LivePlayer, LiveSnapshot } from "@/engine/league-sync";

/**
 * Live Client Data API: o próprio jogo, enquanto a partida roda, serve o
 * estado em https://127.0.0.1:2999. Sem chave, sem conta — só existe na
 * máquina onde o LoL está aberto. É a mesma informação da tela de placar (Tab):
 * itens e nível de todos, e ouro só o seu.
 */
const PORT = 2999;

type RawLiveData = {
  activePlayer?: {
    currentGold?: number;
    level?: number;
    riotId?: string;
    summonerName?: string;
  };
  allPlayers?: {
    championName: string;
    rawChampionName?: string;
    team: "ORDER" | "CHAOS";
    position?: string;
    level: number;
    riotId?: string;
    summonerName?: string;
    items?: { itemID: number; slot: number }[];
    scores?: { kills: number; deaths: number; assists: number; creepScore: number };
    summonerSpells?: {
      summonerSpellOne?: { rawDisplayName?: string };
      summonerSpellTwo?: { rawDisplayName?: string };
    };
  }[];
  gameData?: { gameTime?: number; gameMode?: string; mapNumber?: number };
};

/** "game_character_displayname_MonkeyKing" → "MonkeyKing" */
function championKeyOf(raw: string | undefined): string | null {
  const match = raw?.match(/displayname_(.+)$/);
  return match ? match[1] : null;
}

export function normalizeLiveData(raw: RawLiveData): LiveSnapshot | null {
  if (!raw.allPlayers?.length || !raw.activePlayer) return null;
  const me = raw.activePlayer;

  const players: LivePlayer[] = raw.allPlayers.map((p) => {
    const spells = [
      p.summonerSpells?.summonerSpellOne?.rawDisplayName,
      p.summonerSpells?.summonerSpellTwo?.rawDisplayName,
    ];
    const isSelf =
      (Boolean(me.riotId) && p.riotId === me.riotId) ||
      (Boolean(me.summonerName) && p.summonerName === me.summonerName);
    return {
      championKey: championKeyOf(p.rawChampionName),
      championName: p.championName,
      team: p.team,
      position: (p.position ?? "").toUpperCase(),
      level: p.level,
      itemIds: [...(p.items ?? [])].sort((a, b) => a.slot - b.slot).map((i) => i.itemID),
      hasSmite: spells.some((s) => s?.includes("SummonerSmite")),
      isSelf,
      kills: p.scores?.kills ?? 0,
      deaths: p.scores?.deaths ?? 0,
      assists: p.scores?.assists ?? 0,
      creepScore: p.scores?.creepScore ?? 0,
    };
  });

  return {
    gameTimeSec: raw.gameData?.gameTime ?? 0,
    gameMode: raw.gameData?.gameMode ?? "",
    mapNumber: raw.gameData?.mapNumber ?? 0,
    selfGold: me.currentGold ?? 0,
    selfLevel: me.level ?? 1,
    players,
  };
}

/**
 * Lê a partida em andamento. `null` = não há partida (o jogo não está aberto,
 * ou está na tela de carregamento).
 *
 * `RIFTANDO_LIVE_FIXTURE` aponta para um JSON gravado — para desenvolver sem
 * estar jogando.
 */
export async function readLiveGame(): Promise<LiveSnapshot | null> {
  try {
    const fixture = process.env.RIFTANDO_LIVE_FIXTURE;
    const raw = fixture
      ? (JSON.parse(await readFile(fixture, "utf8")) as RawLiveData)
      : await localJson<RawLiveData>(PORT, "/liveclientdata/allgamedata", { timeoutMs: 1200 });
    return normalizeLiveData(raw);
  } catch {
    return null;
  }
}
