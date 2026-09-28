/**
 * Recorte dos formatos da API da Riot que o Riftando usa. A resposta real tem
 * dezenas de campos a mais; tipar só o que é lido deixa claro do que o motor
 * depende.
 */

export type ParticipantDto = {
  participantId: number;
  puuid: string;
  riotIdGameName?: string;
  riotIdTagline?: string;
  /** id do Data Dragon: "MonkeyKing" */
  championName: string;
  championId: number;
  teamId: 100 | 200;
  /** "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY" | "" */
  teamPosition: string;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  champLevel: number;
  totalMinionsKilled: number;
  neutralMinionsKilled: number;
  goldEarned: number;
  totalDamageDealtToChampions: number;
  visionScore: number;
  item0: number;
  item1: number;
  item2: number;
  item3: number;
  item4: number;
  item5: number;
  item6: number;
  summoner1Id: number;
  summoner2Id: number;
};

export type MatchDto = {
  metadata: { matchId: string; participants: string[] };
  info: {
    gameCreation: number;
    gameStartTimestamp?: number;
    gameDuration: number;
    gameVersion: string;
    queueId: number;
    platformId: string;
    participants: ParticipantDto[];
    teams: { teamId: 100 | 200; win: boolean; bans: { championId: number }[] }[];
  };
};

export type TimelineEvent = {
  type: string;
  timestamp: number;
  participantId?: number;
  itemId?: number;
  /** ITEM_UNDO */
  beforeId?: number;
  afterId?: number;
  killerId?: number;
  victimId?: number;
  assistingParticipantIds?: number[];
  position?: { x: number; y: number };
  monsterType?: string;
  buildingType?: string;
  teamId?: number;
};

export type ParticipantFrame = {
  participantId: number;
  level: number;
  totalGold: number;
  currentGold: number;
  minionsKilled: number;
  jungleMinionsKilled: number;
  xp: number;
  position?: { x: number; y: number };
};

export type TimelineDto = {
  metadata: { matchId: string; participants: string[] };
  info: {
    frameInterval: number;
    frames: {
      timestamp: number;
      participantFrames: Record<string, ParticipantFrame>;
      events: TimelineEvent[];
    }[];
    participants?: { participantId: number; puuid: string }[];
  };
};

export type AccountDto = { puuid: string; gameName: string; tagLine: string };

export type SummonerDto = { puuid: string; profileIconId: number; summonerLevel: number };

export type LeagueEntryDto = {
  queueType: string;
  tier: string;
  rank: string;
  leaguePoints: number;
  wins: number;
  losses: number;
};

export type LeagueListDto = {
  entries: { puuid: string; leaguePoints: number; wins: number; losses: number }[];
};
