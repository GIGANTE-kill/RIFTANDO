/**
 * Tradução do que o cliente do LoL informa para o formato do Riftando.
 *
 * O servidor lê duas fontes locais — o LCU (cliente, fase de seleção) e a Live
 * Client Data API (partida em andamento) — e as entrega cruas, só enxugadas.
 * Este arquivo decide o que elas significam: quem está em que rota, quais
 * itens contam, qual é o seu campeão. TypeScript puro, roda no navegador.
 */
import { ROLES, EMPTY_TEAM, type Role, type TeamSlots } from "./match";
import type { ChampionRef, ItemRef } from "./types";

/* ------------------------------------------------------------ formatos */

export type LiveSide = "ORDER" | "CHAOS";

export type LivePlayer = {
  /** id do Data Dragon extraído de rawChampionName ("MonkeyKing") */
  championKey: string | null;
  /** nome exibido pelo jogo, no idioma do cliente — fallback do championKey */
  championName: string;
  team: LiveSide;
  /** "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY" | "" */
  position: string;
  level: number;
  itemIds: number[];
  hasSmite: boolean;
  isSelf: boolean;
  kills: number;
  deaths: number;
  assists: number;
  creepScore: number;
};

export type LiveSnapshot = {
  gameTimeSec: number;
  gameMode: string;
  mapNumber: number;
  selfGold: number;
  selfLevel: number;
  players: LivePlayer[];
};

export type ChampSelectMember = {
  cellId: number;
  /** id numérico da Riot; 0 = ainda não escolheu */
  championId: number;
  /** "top" | "jungle" | "middle" | "bottom" | "utility" | "" */
  assignedPosition: string;
};

export type ChampSelectSnapshot = {
  localPlayerCellId: number;
  myTeam: ChampSelectMember[];
  theirTeam: ChampSelectMember[];
  bans: number[];
  /** fase do timer: PLANNING, BAN_PICK, FINALIZATION */
  timerPhase: string;
};

export type ClientIdentity = {
  puuid: string;
  gameName: string;
  tagLine: string;
  /** "br1", "na1", "euw1"… — como a API da Riot chama o servidor */
  platform: string | null;
};

/** O que `/api/league` devolve: tudo que o LoL aberto nesta máquina informa. */
export type LeagueState = {
  /**
   * o servidor roda hospedado (Vercel): ele nunca enxerga o LoL de quem está
   * vendo a página — a sincronização só existe rodando no próprio PC
   */
  hosted: boolean;
  /** o cliente (lobby) está aberto */
  client: boolean;
  /** fase do cliente: Lobby, ChampSelect, InProgress, EndOfGame… */
  phase: string | null;
  identity: ClientIdentity | null;
  champSelect: ChampSelectSnapshot | null;
  live: LiveSnapshot | null;
  /** id da última partida terminada, para a revisão pós-jogo */
  lastGameId: number | null;
};

/* ------------------------------------------------------------ rotas */

const LIVE_POSITION: Record<string, Role> = {
  TOP: "TOP",
  JUNGLE: "JUNGLE",
  MIDDLE: "MID",
  BOTTOM: "ADC",
  UTILITY: "SUPPORT",
};

const LCU_POSITION: Record<string, Role> = {
  top: "TOP",
  jungle: "JUNGLE",
  middle: "MID",
  bottom: "ADC",
  utility: "SUPPORT",
};

/** Todas as permutações de 5 rotas — 120, barato o bastante para força bruta. */
const PERMUTATIONS: Role[][] = (() => {
  const out: Role[][] = [];
  const walk = (rest: Role[], acc: Role[]) => {
    if (!rest.length) out.push(acc);
    rest.forEach((r, i) => walk([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, r]));
  };
  walk([...ROLES], []);
  return out;
})();

type RoleCandidate = {
  championId: string;
  /** rota já conhecida (o jogo ou o cliente disse) — não é negociável */
  fixed?: Role | null;
  /** quem leva Golpear é o caçador: mais confiável que qualquer lista de rotas */
  hasSmite?: boolean;
};

/**
 * 0..1 — com que frequência o campeão joga naquela rota. Vem das partidas
 * coletadas (`npm run crawl`) quando existem.
 */
export type RolePrior = (championId: string, role: Role) => number | undefined;

/**
 * Afinidade da classe oficial da Riot com cada rota. Só desempata: a lista de
 * rotas do campeão vem em ordem alfabética, então ela diz *onde* ele joga mas
 * não *onde mais*. Sem isso Zed (selva, meio) ia para a selva e empurrava a
 * Lux para o meio.
 */
const CLASS_AFFINITY: Record<Role, Record<string, number>> = {
  TOP: { Fighter: 0.8, Tank: 0.6 },
  JUNGLE: {},
  MID: { Mage: 1, Assassin: 1 },
  ADC: { Marksman: 1.5 },
  SUPPORT: { Support: 1.2 },
};

function roleAffinity(champion: ChampionRef | undefined, role: Role): number {
  if (!champion) return 0;
  return Math.max(0, ...champion.classes.map((c) => CLASS_AFFINITY[role][c] ?? 0));
}

/**
 * Distribui até 5 campeões nas 5 rotas.
 *
 * O time inimigo na seleção e a partida em modo normal não dizem quem joga
 * onde. A lista de rotas de cada campeão diz onde ele *costuma* jogar; o que
 * decide é a distribuição que respeita o time inteiro. Lux e Brand podem ir
 * tanto para o meio quanto para o suporte — mas não os dois para o meio.
 */
export function assignRoles(
  candidates: RoleCandidate[],
  champions: Map<string, ChampionRef>,
  prior?: RolePrior,
): TeamSlots {
  const list = candidates.slice(0, 5);

  // pontuação de cada campeão em cada rota, calculada uma vez só
  const fitOf = list.map((c) => {
    const champion = champions.get(c.championId);
    return Object.fromEntries(
      ROLES.map((role) => {
        let score = champion?.positions.includes(role) ? 3 : 0;
        const share = prior?.(c.championId, role);
        // com dados reais, a frequência manda; sem eles, a classe desempata
        score += share !== undefined ? share * 4 : roleAffinity(champion, role);
        if (c.hasSmite) score += role === "JUNGLE" ? 8 : -8;
        return [role, score];
      }),
    ) as Record<Role, number>;
  });

  let best: { score: number; roles: Role[] } | null = null;
  for (const perm of PERMUTATIONS) {
    let score = 0;
    let valid = true;
    for (let i = 0; i < list.length; i++) {
      const fixed = list[i].fixed;
      if (fixed && fixed !== perm[i]) {
        valid = false;
        break;
      }
      score += fixed ? 10 : fitOf[i][perm[i]];
    }
    if (valid && (!best || score > best.score)) best = { score, roles: perm };
  }

  const slots: TeamSlots = { ...EMPTY_TEAM };
  if (!best) {
    // nenhuma distribuição respeita as rotas fixas (dado inconsistente):
    // coloca na ordem em que vieram, sem inventar
    list.forEach((c, i) => (slots[ROLES[i]] = c.championId));
    return slots;
  }
  list.forEach((c, i) => (slots[best!.roles[i]] = c.championId));
  return slots;
}

/* ------------------------------------------------------------ seleção */

export type DraftFromClient = {
  myRole: Role | null;
  allies: TeamSlots;
  enemies: TeamSlots;
  bans: string[];
};

export function draftFromChampSelect(
  snapshot: ChampSelectSnapshot,
  champions: Map<string, ChampionRef>,
  prior?: RolePrior,
): DraftFromClient {
  const byRiotId = new Map([...champions.values()].map((c) => [c.riotId, c.id]));
  const idOf = (n: number) => (n > 0 ? (byRiotId.get(n) ?? null) : null);

  const me = snapshot.myTeam.find((m) => m.cellId === snapshot.localPlayerCellId);
  const myRole = me ? (LCU_POSITION[me.assignedPosition] ?? null) : null;

  // aliados: em fila ranqueada o cliente diz a rota de cada um
  const allies: TeamSlots = { ...EMPTY_TEAM };
  const allyUnplaced: RoleCandidate[] = [];
  for (const m of snapshot.myTeam) {
    const id = idOf(m.championId);
    if (!id) continue;
    const role = LCU_POSITION[m.assignedPosition];
    if (role && !allies[role]) allies[role] = id;
    else allyUnplaced.push({ championId: id });
  }
  if (allyUnplaced.length) {
    const fixed = ROLES.filter((r) => allies[r]).map((r) => ({
      championId: allies[r]!,
      fixed: r,
    }));
    Object.assign(allies, assignRoles([...fixed, ...allyUnplaced], champions, prior));
  }

  // inimigos: o cliente nunca revela a rota deles — distribui pelo time inteiro
  const enemyIds = snapshot.theirTeam.map((m) => idOf(m.championId)).filter(Boolean) as string[];
  const enemies = enemyIds.length
    ? assignRoles(enemyIds.map((championId) => ({ championId })), champions, prior)
    : { ...EMPTY_TEAM };

  const bans = [...new Set(snapshot.bans.map(idOf).filter((x): x is string => Boolean(x)))];

  return { myRole, allies, enemies, bans };
}

/* ------------------------------------------------------------ partida */

export type MatchFromClient = {
  myRole: Role;
  allies: TeamSlots;
  enemies: TeamSlots;
  allyItems: Record<string, number[]>;
  enemyItems: Record<string, number[]>;
  levels: Record<string, number>;
  minute: number;
  myLevel: number;
  myGold: number;
};

/** Poção, sentinela e bugiganga não mudam a análise — só ocupam slot. */
function countsAsItem(item: ItemRef | undefined): boolean {
  if (!item) return false;
  return !item.categories.some((c) => c === "Consumable" || c === "Trinket" || c === "Vision");
}

export function resolveLiveChampion(
  player: Pick<LivePlayer, "championKey" | "championName">,
  champions: Map<string, ChampionRef>,
): string | null {
  if (player.championKey && champions.has(player.championKey)) return player.championKey;
  const byName = [...champions.values()].find(
    (c) => c.name.toLowerCase() === player.championName.toLowerCase(),
  );
  return byName?.id ?? null;
}

export function matchFromLive(
  snapshot: LiveSnapshot,
  champions: Map<string, ChampionRef>,
  items: Map<number, ItemRef>,
  prior?: RolePrior,
): MatchFromClient | null {
  const self = snapshot.players.find((p) => p.isSelf);
  if (!self) return null;

  const resolved = snapshot.players
    .map((p) => ({ player: p, id: resolveLiveChampion(p, champions) }))
    .filter((r): r is { player: LivePlayer; id: string } => Boolean(r.id));

  const place = (side: LiveSide) =>
    assignRoles(
      resolved
        .filter((r) => r.player.team === side)
        .map((r) => ({
          championId: r.id,
          fixed: LIVE_POSITION[r.player.position] ?? null,
          hasSmite: r.player.hasSmite,
        })),
      champions,
      prior,
    );

  const allies = place(self.team);
  const enemies = place(self.team === "ORDER" ? "CHAOS" : "ORDER");

  const selfId = resolveLiveChampion(self, champions);
  const myRole = ROLES.find((r) => allies[r] && allies[r] === selfId) ?? "MID";

  const allyItems: Record<string, number[]> = {};
  const enemyItems: Record<string, number[]> = {};
  const levels: Record<string, number> = {};
  for (const { player, id } of resolved) {
    const owned = player.itemIds.filter((i) => countsAsItem(items.get(i))).slice(0, 6);
    (player.team === self.team ? allyItems : enemyItems)[id] = owned;
    levels[id] = player.level;
  }

  return {
    myRole,
    allies,
    enemies,
    allyItems,
    enemyItems,
    levels,
    minute: Math.floor(snapshot.gameTimeSec / 60),
    myLevel: snapshot.selfLevel,
    myGold: Math.floor(snapshot.selfGold),
  };
}
