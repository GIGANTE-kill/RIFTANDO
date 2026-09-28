/**
 * Revisão pós-jogo: a partida real passada, minuto a minuto, pelos mesmos
 * motores que dão conselho ao vivo.
 *
 * Um site de estatística mostra o placar e a build. Esta revisão responde a
 * pergunta que o placar não responde: *o que eu deveria ter feito diferente*.
 * Cada compra é comparada com o que o motor de itens recomendaria naquele
 * minuto, com aqueles inimigos e aqueles itens; cada morte é classificada
 * (gank, 1 contra 1, isolado, luta em desvantagem); e a rota é comparada com o
 * que o confronto prometia.
 *
 * TypeScript puro: recebe os JSONs da Riot, devolve a leitura.
 */
import { analyze, type Catalog, type Recommendation } from "./itemization";
import { analyzeMatchup, verdictLabel, type MatchupCatalog, type MatchupAnalysis } from "./matchup";
import { analyzeTeam, opponentsFor, type Role, type TeamSlots } from "./match";
import type { ChampionRef, ItemRef, MatchState } from "./types";
import type { MatchDto, ParticipantDto, TimelineDto, TimelineEvent } from "@/lib/riot/types";

const POSITION: Record<string, Role> = {
  TOP: "TOP",
  JUNGLE: "JUNGLE",
  MIDDLE: "MID",
  BOTTOM: "ADC",
  UTILITY: "SUPPORT",
};

export type ReviewPlayer = {
  participantId: number;
  puuid: string;
  name: string;
  champion: ChampionRef | undefined;
  championName: string;
  role: Role | null;
  teamId: 100 | 200;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  gold: number;
  damage: number;
  visionScore: number;
  level: number;
  items: number[];
};

export type PurchaseReview = {
  minute: number;
  item: ItemRef;
  verdict: "ALINHADO" | "LIVRE" | "DIVERGIU";
  /** o que o motor recomendava naquele minuto */
  recommended: Recommendation[];
  note: string;
};

export type DeathKind = "GANK" | "DUELO" | "ISOLADO" | "DESVANTAGEM" | "LUTA" | "ESTRUTURA";

export type DeathReview = {
  minute: number;
  second: number;
  kind: DeathKind;
  killer: ReviewPlayer | null;
  enemiesInvolved: number;
  alliesNear: number;
  text: string;
};

export type LaneReview = {
  opponent: ReviewPlayer | null;
  expected: MatchupAnalysis;
  goldDiff10: number | null;
  goldDiff14: number | null;
  csDiff10: number | null;
  csDiff14: number | null;
  outcome: "GANHOU" | "EMPATOU" | "PERDEU" | null;
  text: string;
};

export type Review = {
  matchId: string;
  durationMin: number;
  me: ReviewPlayer;
  players: ReviewPlayer[];
  lane: LaneReview;
  purchases: PurchaseReview[];
  deaths: DeathReview[];
  /** diferença de ouro do seu time por minuto (positivo = à frente) */
  teamGold: { minute: number; diff: number }[];
  /** as 3 lições mais importantes, já em ordem */
  lessons: { title: string; detail: string }[];
};

/* ------------------------------------------------------------ inventário */

/**
 * Reconstrói o inventário de todos os jogadores evento a evento. A linha do
 * tempo não traz "o que ele tinha no minuto 14" — traz cada compra, venda,
 * componente consumido e desfazer. Replicar a sequência é a única forma.
 */
class Inventory {
  private bags = new Map<number, number[]>();

  apply(e: TimelineEvent) {
    if (!e.participantId) return;
    const bag = this.bags.get(e.participantId) ?? [];
    const remove = (id: number | undefined) => {
      const i = id ? bag.indexOf(id) : -1;
      if (i >= 0) bag.splice(i, 1);
    };
    switch (e.type) {
      case "ITEM_PURCHASED":
        if (e.itemId) bag.push(e.itemId);
        break;
      case "ITEM_SOLD":
      case "ITEM_DESTROYED":
        remove(e.itemId);
        break;
      case "ITEM_UNDO":
        // desfazer compra: beforeId some; desfazer venda: afterId volta
        if (e.beforeId) remove(e.beforeId);
        if (e.afterId) bag.push(e.afterId);
        break;
    }
    this.bags.set(e.participantId, bag);
  }

  of(participantId: number) {
    return [...(this.bags.get(participantId) ?? [])];
  }
}

/* ------------------------------------------------------------ helpers */

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

/** "perto o bastante para ajudar" — pouco mais que um alcance de Flash + ultimate */
const NEAR = 2200;

const formatGold = (n: number) => `${n > 0 ? "+" : ""}${n.toLocaleString("pt-BR")}`;
const formatDecimal = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function countsAsItem(item: ItemRef | undefined): item is ItemRef {
  return Boolean(item) && !item!.categories.some((c) => c === "Consumable" || c === "Trinket" || c === "Vision");
}

/* ------------------------------------------------------------ revisão */

export function buildReview({
  match,
  timeline,
  puuid,
  catalog,
  matchupCatalog,
}: {
  match: MatchDto;
  timeline: TimelineDto;
  puuid: string;
  catalog: Catalog;
  matchupCatalog: MatchupCatalog;
}): Review | null {
  const info = match.info;
  const meRaw = info.participants.find((p) => p.puuid === puuid);
  if (!meRaw) return null;

  const toPlayer = (p: ParticipantDto): ReviewPlayer => ({
    participantId: p.participantId,
    puuid: p.puuid,
    name: p.riotIdGameName ? `${p.riotIdGameName}#${p.riotIdTagline ?? ""}` : p.championName,
    champion: catalog.champions.get(p.championName),
    championName: catalog.champions.get(p.championName)?.name ?? p.championName,
    role: POSITION[p.teamPosition] ?? null,
    teamId: p.teamId,
    win: p.win,
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    cs: p.totalMinionsKilled + p.neutralMinionsKilled,
    gold: p.goldEarned,
    damage: p.totalDamageDealtToChampions,
    visionScore: p.visionScore,
    level: p.champLevel,
    items: [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5].filter((i) => i > 0),
  });

  const players = info.participants.map(toPlayer);
  const me = players.find((p) => p.puuid === puuid)!;
  const byPid = new Map(players.map((p) => [p.participantId, p]));
  const allies = players.filter((p) => p.teamId === me.teamId);
  const enemies = players.filter((p) => p.teamId !== me.teamId);
  const myRole: Role = me.role ?? "MID";

  const slots = (team: ReviewPlayer[]): TeamSlots => {
    const s: TeamSlots = { TOP: null, JUNGLE: null, MID: null, ADC: null, SUPPORT: null };
    for (const p of team) if (p.role && p.champion) s[p.role] = p.champion.id;
    return s;
  };
  const allySlots = slots(allies);
  const enemySlots = slots(enemies);

  const opponentChampionId = opponentsFor(myRole, enemySlots).primary;
  const opponent = enemies.find((p) => p.champion?.id === opponentChampionId) ?? null;
  const enemyJungler = enemies.find((p) => p.role === "JUNGLE") ?? null;

  const frames = timeline.info.frames;
  const frameAt = (ms: number) => {
    let best = frames[0];
    for (const f of frames) if (Math.abs(f.timestamp - ms) < Math.abs(best.timestamp - ms)) best = f;
    return best;
  };
  const frameBefore = (ms: number) => {
    let best = frames[0];
    for (const f of frames) if (f.timestamp <= ms) best = f;
    return best;
  };

  /* ---------------- rota */

  const expected = analyzeMatchup(
    {
      selfChampionId: me.champion?.id ?? null,
      enemyChampionId: opponent?.champion?.id ?? null,
      allyJungleId: allySlots.JUNGLE,
      enemyJungleId: enemySlots.JUNGLE,
    },
    matchupCatalog,
  );

  const diffAt = (minute: number) => {
    const f = frames[minute];
    if (!f || !opponent) return null;
    const mine = f.participantFrames[String(me.participantId)];
    const theirs = f.participantFrames[String(opponent.participantId)];
    if (!mine || !theirs) return null;
    return {
      gold: mine.totalGold - theirs.totalGold,
      cs:
        mine.minionsKilled + mine.jungleMinionsKilled - (theirs.minionsKilled + theirs.jungleMinionsKilled),
    };
  };
  const d10 = diffAt(10);
  const d14 = diffAt(14);
  const laneGold = d14?.gold ?? d10?.gold ?? null;
  const outcome =
    laneGold === null ? null : laneGold >= 400 ? "GANHOU" : laneGold <= -400 ? "PERDEU" : "EMPATOU";

  const lane: LaneReview = {
    opponent,
    expected,
    goldDiff10: d10?.gold ?? null,
    goldDiff14: d14?.gold ?? null,
    csDiff10: d10?.cs ?? null,
    csDiff14: d14?.cs ?? null,
    outcome,
    text: laneText(expected, outcome, laneGold, opponent, myRole),
  };

  /* ---------------- compras e mortes: uma passada pela linha do tempo */

  const inventory = new Inventory();
  const events = frames.flatMap((f) => f.events).sort((a, b) => a.timestamp - b.timestamp);
  const purchases: PurchaseReview[] = [];
  const deaths: DeathReview[] = [];
  const allyIds = allies.filter((p) => p !== me).map((p) => p.champion?.id).filter(Boolean) as string[];

  const stateAt = (ms: number): MatchState => {
    const frame = frameBefore(ms);
    const levelOf = (p: ReviewPlayer) =>
      frame.participantFrames[String(p.participantId)]?.level ?? 1;
    const itemsOf = (p: ReviewPlayer) =>
      inventory
        .of(p.participantId)
        .filter((id) => countsAsItem(catalog.items.get(id)))
        .slice(0, 6);
    return {
      selfRole: myRole,
      self: { championId: me.champion?.id ?? null, level: levelOf(me), itemIds: itemsOf(me), gold: 0 },
      threat: {
        championId: opponent?.champion?.id ?? null,
        level: opponent ? levelOf(opponent) : 1,
        itemIds: opponent ? itemsOf(opponent) : [],
      },
      enemyTeam: enemies
        .filter((p) => p !== opponent && p.champion)
        .map((p) => ({ championId: p.champion!.id, level: levelOf(p), itemIds: itemsOf(p) })),
      allyTeam: allies
        .filter((p) => p !== me && p.champion)
        .map((p) => ({ championId: p.champion!.id, level: levelOf(p), itemIds: itemsOf(p) })),
    };
  };

  for (const e of events) {
    if (e.type === "ITEM_PURCHASED" && e.participantId === me.participantId && e.itemId) {
      const item = catalog.items.get(e.itemId);
      if (item?.isLegendary) {
        // o estado *antes* da compra: o motor não pode "recomendar" o que já foi comprado
        const state = stateAt(e.timestamp);
        state.self.gold = item.totalGold;
        const analysis = analyze(state, catalog, 3, allyIds);
        purchases.push(
          judgePurchase(Math.floor(e.timestamp / 60000), item, analysis.recommendations, catalog),
        );
      }
    }

    if (e.type === "CHAMPION_KILL" && e.victimId === me.participantId) {
      deaths.push(
        judgeDeath(e, {
          me,
          myRole,
          allies,
          byPid,
          enemyJungler,
          frame: frameAt(e.timestamp),
        }),
      );
    }

    inventory.apply(e);
  }

  // o mesmo item pedido compra após compra: o motivo completo aparece uma vez,
  // as seguintes só lembram — quatro parágrafos iguais seriam ruído
  const firstAsked = new Map<number, number>();
  for (const p of purchases) {
    if (p.verdict !== "DIVERGIU") continue;
    const wanted = p.recommended[0].item;
    const since = firstAsked.get(wanted.id);
    if (since === undefined) firstAsked.set(wanted.id, p.minute);
    else p.note = `Ainda sem ${wanted.name} — o mesmo motivo do minuto ${since}.`;
  }

  /* ---------------- ouro do time */

  const teamGold = frames.map((f, minute) => {
    let diff = 0;
    for (const p of players) {
      const g = f.participantFrames[String(p.participantId)]?.totalGold ?? 0;
      diff += p.teamId === me.teamId ? g : -g;
    }
    return { minute, diff };
  });

  const durationMin = info.gameDuration / 60;

  return {
    matchId: match.metadata.matchId,
    durationMin,
    me,
    players,
    lane,
    purchases,
    deaths,
    teamGold,
    lessons: buildLessons({ me, myRole, lane, purchases, deaths, durationMin, enemyJungler, enemies, catalog }),
  };
}

/* ------------------------------------------------------------ julgamentos */

function laneText(
  expected: MatchupAnalysis,
  outcome: LaneReview["outcome"],
  gold: number | null,
  opponent: ReviewPlayer | null,
  role: Role,
): string {
  if (!opponent || outcome === null || gold === null)
    return "Sem oponente de rota identificado nesta partida.";

  const promise =
    expected.score >= 1.5 ? "a seu favor" : expected.score <= -1.5 ? "contra você" : "equilibrado";
  const result =
    outcome === "GANHOU"
      ? `saiu da rota ${formatGold(gold)} de ouro à frente`
      : outcome === "PERDEU"
        ? `saiu da rota ${formatGold(gold)} de ouro atrás`
        : `saiu da rota empatado (${formatGold(gold)} de ouro)`;
  const vs = `${opponent.championName}${role === "JUNGLE" ? " (selva)" : ""}`;

  if (promise === "a seu favor" && outcome !== "GANHOU")
    return `O confronto contra ${vs} era ${promise} (${verdictLabel(expected.verdict).toLowerCase()}), mas você ${result}. A vantagem estava no papel e não virou ouro — a diferença foi execução.`;
  if (promise === "contra você" && outcome !== "PERDEU")
    return `O confronto contra ${vs} era ${promise} e você ${result}. Isso é jogar acima do confronto — o plano de rota funcionou.`;
  if (promise === "contra você")
    return `O confronto contra ${vs} era ${promise} e você ${result}. Esperado: aqui o objetivo é perder por pouco, farmar sob a torre e chegar inteiro no meio de jogo.`;
  return `O confronto contra ${vs} era ${promise} e você ${result}.`;
}

function judgePurchase(
  minute: number,
  item: ItemRef,
  recs: Recommendation[],
  catalog: Catalog,
): PurchaseReview {
  if (!recs.length)
    return {
      minute,
      item,
      verdict: "LIVRE",
      recommended: [],
      note: "Nenhuma ameaça pedia um item específico neste momento — escolha livre da sua build.",
    };

  const match = recs.find(
    (r) => r.item.id === item.id || r.item.buildsFrom.includes(item.id) || item.buildsFrom.includes(r.item.id),
  );
  if (match)
    return {
      minute,
      item,
      verdict: "ALINHADO",
      recommended: recs,
      note: `Era a resposta certa: ${match.reasons[0]?.title.toLowerCase() ?? "atende a ameaça do momento"}.`,
    };

  // o item comprado pode resolver o mesmo problema por outra via (outra
  // fonte de corta-cura, outra resistência mágica): vale o efeito que a regra
  // pediu, não o nome do item
  const top = recs[0];
  const wanted = new Set(
    top.reasons.flatMap((r) => catalog.rules.find((rule) => rule.slug === r.slug)?.recommendTagSlugs ?? []),
  );
  if (item.tags.some((t) => wanted.has(t))) {
    return {
      minute,
      item,
      verdict: "ALINHADO",
      recommended: recs,
      note: `Resolve o mesmo problema por outro caminho que ${top.item.name}: ${top.reasons[0].title.toLowerCase()}.`,
    };
  }

  return {
    minute,
    item,
    verdict: "DIVERGIU",
    recommended: recs,
    note: `Naquele minuto o motor recomendava ${top.item.name}: ${top.reasons[0]?.explanation ?? top.reasons[0]?.title ?? ""}`,
  };
}

function judgeDeath(
  e: TimelineEvent,
  ctx: {
    me: ReviewPlayer;
    myRole: Role;
    allies: ReviewPlayer[];
    byPid: Map<number, ReviewPlayer>;
    enemyJungler: ReviewPlayer | null;
    frame: TimelineDto["info"]["frames"][number];
  },
): DeathReview {
  const minute = Math.floor(e.timestamp / 60000);
  const second = Math.floor((e.timestamp % 60000) / 1000);
  const killer = e.killerId ? (ctx.byPid.get(e.killerId) ?? null) : null;
  const involvedIds = new Set([e.killerId ?? 0, ...(e.assistingParticipantIds ?? [])].filter((id) => id > 0));
  const enemiesInvolved = [...involvedIds].filter((id) => ctx.byPid.get(id)?.teamId !== ctx.me.teamId).length;

  // posição dos aliados no quadro mais próximo (a Riot grava um por minuto:
  // é aproximado, por isso a margem generosa de "perto")
  const alliesNear = e.position
    ? ctx.allies.filter((a) => {
        if (a === ctx.me) return false;
        const pos = ctx.frame.participantFrames[String(a.participantId)]?.position;
        return pos ? distance(pos, e.position!) <= NEAR : false;
      }).length
    : 0;

  const junglerIn = ctx.enemyJungler ? involvedIds.has(ctx.enemyJungler.participantId) : false;
  const killerName = killer?.championName ?? "torre ou tropa";

  let kind: DeathKind;
  let text: string;
  if (!killer || killer.teamId === ctx.me.teamId) {
    kind = "ESTRUTURA";
    text = "Executado por torre ou tropa — mergulho ou recuo tarde demais.";
  } else if (minute < 14 && junglerIn && ctx.myRole !== "JUNGLE" && enemiesInvolved >= 2) {
    kind = "GANK";
    text = `Gank de ${ctx.enemyJungler!.championName} (${enemiesInvolved} inimigos). Sem visão do lado dele do rio, a rota avançada vira alvo.`;
  } else if (enemiesInvolved === 1) {
    kind = "DUELO";
    text = `Perdeu o 1 contra 1 para ${killerName}.`;
  } else if (minute >= 14 && alliesNear === 0) {
    kind = "ISOLADO";
    text = `Pego sozinho por ${enemiesInvolved} inimigos, sem nenhum aliado por perto. Depois dos 14, andar sozinho sem visão é o erro mais caro do jogo.`;
  } else if (enemiesInvolved > alliesNear + 1) {
    kind = "DESVANTAGEM";
    text = `Luta ${alliesNear + 1} contra ${enemiesInvolved}: entrou (ou ficou) em desvantagem numérica.`;
  } else {
    kind = "LUTA";
    text = `Morreu em luta de equipe (${alliesNear + 1} contra ${enemiesInvolved}).`;
  }

  return { minute, second, kind, killer, enemiesInvolved, alliesNear, text };
}

function buildLessons({
  me,
  myRole,
  lane,
  purchases,
  deaths,
  durationMin,
  enemyJungler,
  enemies,
  catalog,
}: {
  me: ReviewPlayer;
  myRole: Role;
  lane: LaneReview;
  purchases: PurchaseReview[];
  deaths: DeathReview[];
  durationMin: number;
  enemyJungler: ReviewPlayer | null;
  enemies: ReviewPlayer[];
  catalog: Catalog;
}): Review["lessons"] {
  const candidates: { weight: number; title: string; detail: string }[] = [];

  const ganks = deaths.filter((d) => d.kind === "GANK");
  if (ganks.length >= 2 && enemyJungler)
    candidates.push({
      weight: 90 + ganks.length * 5,
      title: `${ganks.length} mortes para gank antes dos 14`,
      detail: `${enemyJungler.championName} decidiu a sua rota. ${lane.expected.gankRisk.reason} Com a onda do lado inimigo e sem sentinela no rio, recue ao ver dois inimigos sumirem do mapa.`,
    });

  const isolated = deaths.filter((d) => d.kind === "ISOLADO");
  if (isolated.length >= 2)
    candidates.push({
      weight: 85 + isolated.length * 5,
      title: `${isolated.length} mortes sozinho no meio/fim de jogo`,
      detail: `Minutos ${isolated.map((d) => d.minute).join(", ")}. Cada uma delas deixou o seu time lutando 4 contra 5 ou entregou um objetivo. Empurre a rota lateral só com visão e com a posição do caçador inimigo conhecida.`,
    });

  // Quatro compras "erradas" pelo mesmo motivo são um erro só: o item que a
  // partida pedia e nunca veio. Agrupar pelo item recomendado evita que uma
  // única lacuna ocupe as três lições.
  const diverged = purchases.filter((p) => p.verdict === "DIVERGIU");
  const missing = new Map<number, PurchaseReview[]>();
  for (const p of diverged) {
    const id = p.recommended[0].item.id;
    missing.set(id, [...(missing.get(id) ?? []), p]);
  }
  const ownedTree = new Set(me.items.flatMap((id) => [id, ...(catalog.items.get(id)?.buildsFrom ?? [])]));
  let missingAntiHeal = false;
  for (const [itemId, list] of missing) {
    const wanted = list[0].recommended[0];
    const neverBought = !ownedTree.has(itemId);
    if (neverBought && wanted.item.tags.includes("ANTI_HEAL")) missingAntiHeal = true;
    candidates.push({
      weight: 70 + Math.min(4, list.length) * 4 + (neverBought ? 6 : 0),
      title: neverBought
        ? `${wanted.item.name} pedido desde o minuto ${list[0].minute} e nunca comprado`
        : `Minuto ${list[0].minute}: ${list[0].item.name} antes de ${wanted.item.name}`,
      detail: `${wanted.reasons[0]?.explanation ?? wanted.reasons[0]?.title ?? ""} O motor pediu esse item em ${list.length} de ${purchases.length} compras de lendário (minutos ${list.map((p) => p.minute).join(", ")}).`,
    });
  }

  if (lane.outcome === "PERDEU" && lane.expected.score >= 1.5)
    candidates.push({
      weight: 80,
      title: "Rota favorável que virou desvantagem",
      detail: lane.text,
    });
  else if (lane.outcome === "GANHOU" && lane.expected.score <= -1.5)
    candidates.push({
      weight: 40,
      title: "Você venceu uma rota desfavorável",
      detail: lane.text,
    });

  const duels = deaths.filter((d) => d.kind === "DUELO");
  if (duels.length >= 2) {
    const killers = [...new Set(duels.map((d) => d.killer?.championName).filter(Boolean))];
    candidates.push({
      weight: 65 + duels.length * 4,
      title: `${duels.length} duelos perdidos`,
      detail: `Para ${killers.join(", ")}. Antes de trocar, compare nível e itens — o termômetro de combate do Riftando faz essa conta ao vivo.`,
    });
  }

  const csPerMin = me.cs / Math.max(1, durationMin);
  if (myRole !== "SUPPORT" && myRole !== "JUNGLE" && csPerMin < 6.5) {
    // ~21 de ouro por minion, na média entre tropas corpo a corpo, mago e canhão
    const extra = Math.round(((7 - csPerMin) * durationMin * 21) / 100) * 100;
    candidates.push({
      weight: 55 + (6.5 - csPerMin) * 8,
      title: `Farm de ${formatDecimal(csPerMin)} por minuto`,
      detail: `Uns 14 minions valem o ouro de um abate. Subir para 7 por minuto daria ~${extra.toLocaleString("pt-BR")} de ouro a mais nesta partida — ${extra >= 2500 ? "praticamente um item lendário" : extra >= 1000 ? "um componente grande" : "o que decide um duelo apertado"}.`,
    });
  }

  const visionPerMin = me.visionScore / Math.max(1, durationMin);
  if ((myRole === "SUPPORT" || myRole === "JUNGLE") && visionPerMin < 1.2)
    candidates.push({
      weight: 50,
      title: `Placar de visão baixo (${formatDecimal(visionPerMin)} por minuto)`,
      detail: "Na sua função a visão é o recurso do time inteiro. Acima de 1,5/min é o mínimo para jogar objetivos com informação.",
    });

  // o que o time inimigo exigia e nunca foi comprado
  const team = analyzeTeam(
    enemies.map((e) => e.champion?.id ?? null),
    catalog.champions,
    me.champion,
  );
  const antiHeal = me.items.some((id) => catalog.items.get(id)?.tags.includes("ANTI_HEAL"));
  if (team.healingSources.length >= 2 && !antiHeal && !missingAntiHeal)
    candidates.push({
      weight: 60,
      title: "Nenhum corta-cura contra time que se cura",
      detail: `${team.healingSources.map((c) => c.name).join(", ")} se curavam, e a sua build terminou sem Feridas Graves.`,
    });

  if (!candidates.length)
    candidates.push({
      weight: 1,
      title: "Partida limpa",
      detail: "Nenhum padrão de erro se repetiu: rota dentro do esperado, compras alinhadas e mortes sem padrão.",
    });

  return candidates
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map(({ title, detail }) => ({ title, detail }));
}

