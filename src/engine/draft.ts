/**
 * Assistente de seleção. Responde, a cada pick do inimigo, "quem eu pego agora".
 *
 * ⚠️ IMPORTANTE — o que este motor NÃO é: um tier list. Taxa de vitória real só
 * existe em API paga ou raspagem de site, e esta ferramenta não usa nenhuma das
 * duas. "Melhor escolha" aqui significa *melhor resposta ao que já está no
 * quadro*: quem vence o confronto direto, quem tapa o buraco da sua composição
 * e quem combina com o seu parceiro de rota. É um critério diferente de "o
 * campeão mais forte do patch", e melhor para o que você está decidindo agora.
 */
import { analyzeMatchup, type MatchupCatalog } from "./matchup";
import type { Role, TeamSlots } from "./match";
import { ROLE_LABEL } from "./match";
import type { ChampionRef } from "./types";

export type DraftBoard = {
  myRole: Role;
  allies: TeamSlots;
  enemies: TeamSlots;
  /** ids banidos pelos dois times */
  bans: string[];
};

export type PickSuggestion = {
  champion: ChampionRef;
  score: number;
  /** motivos legíveis, já em português */
  reasons: string[];
  counterScore: number;
};

const weightOf = (champion: ChampionRef | undefined, slug: string) =>
  (champion?.tags.find((t) => t.slug === slug)?.weight ?? 0) / 100;

/**
 * "Força" na rota quando o inimigo ainda não escolheu.
 *
 * Sem taxa de vitória, a pergunta "quem é forte no meio?" não tem resposta
 * direta. Mas tem uma resposta computável: **contra quantos campeões daquela
 * rota esse campeão vence o confronto**. É a média do placar de matchup contra
 * todos os oponentes possíveis — ou seja, quem é seguro de pegar sem saber o
 * que vem pela frente. É literalmente o critério de "pick cego".
 *
 * São ~3600 confrontos por rota; o cache faz isso rodar uma vez só.
 */
const blindCache = new WeakMap<MatchupCatalog, Map<string, number>>();

export function blindPickScore(
  champion: ChampionRef,
  role: Role,
  catalog: MatchupCatalog,
): number {
  let cache = blindCache.get(catalog);
  if (!cache) {
    cache = new Map();
    blindCache.set(catalog, cache);
  }
  const key = `${champion.id}|${role}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const opponents = [...catalog.champions.values()].filter(
    (c) => c.id !== champion.id && c.positions.includes(role),
  );
  if (!opponents.length) {
    cache.set(key, 0);
    return 0;
  }

  let sum = 0;
  for (const opponent of opponents) {
    sum += analyzeMatchup(
      {
        selfChampionId: champion.id,
        enemyChampionId: opponent.id,
        allyJungleId: null,
        enemyJungleId: null,
      },
      catalog,
    ).score;
  }

  const average = sum / opponents.length;
  cache.set(key, average);
  return average;
}

/**
 * O confronto 1 contra 1 não modela todas as rotas igual.
 *
 * Topo e meio SÃO um duelo — o placar de matchup manda. Suporte joga 2 contra 2
 * e vale pela utilidade: enfiar o motor de duelo lá dentro fazia a lista de
 * suportes vir cheia de Camille e Shaco. A selva não tem oponente de rota: o
 * que importa é conseguir chegar e prender.
 *
 * Os eixos vêm da própria Riot (playstyleInfo), não de palpite meu.
 */
const ROLE_MODEL: Record<
  Role,
  { blindWeight: number; axes: Partial<Record<keyof NonNullable<ChampionRef["playstyle"]>, number>> }
> = {
  TOP: { blindWeight: 2, axes: { durability: 0.3 } },
  MID: { blindWeight: 2, axes: { damage: 0.3 } },
  JUNGLE: { blindWeight: 0.5, axes: { crowdControl: 0.9, mobility: 0.8, damage: 0.3 } },
  ADC: { blindWeight: 1.4, axes: { damage: 0.8 } },
  SUPPORT: { blindWeight: 0.5, axes: { utility: 1.3, crowdControl: 1, damage: -0.2 } },
};

/** Quanto o kit do campeão combina com o que a rota exige. */
function roleFit(champion: ChampionRef, role: Role): number {
  const model = ROLE_MODEL[role];
  let fit = 0;

  if (champion.playstyle) {
    for (const [axis, weight] of Object.entries(model.axes)) {
      const value = champion.playstyle[axis as keyof NonNullable<ChampionRef["playstyle"]>] ?? 0;
      // eixo vai de 1 a 3; 2 é o neutro
      fit += (value - 2) * (weight ?? 0);
    }
  }

  // A rota do atirador não é um duelo: é bater de longe, atrás dos minions e do
  // suporte. O motor de matchup dizia (com razão) que Yasuo vence Caitlyn no 1
  // contra 1 — e por isso o colocava como melhor atirador, o que é péssimo
  // conselho. A classe oficial da Riot resolve: quem foi desenhado para a função.
  if (role === "ADC" && !champion.classes.includes("Marksman")) {
    fit -= 2.5;
    // Nilah também é Lutador/Assassino e é atiradora de verdade — a diferença
    // é que ela SÓ joga ali. Quem aparece em três rotas está de passagem na
    // rota de baixo, não é a especialidade dele.
    if (champion.positions.length >= 3) fit -= 1.5;
  }

  return fit;
}

const takenIds = (board: DraftBoard) =>
  new Set(
    [...Object.values(board.allies), ...Object.values(board.enemies), ...board.bans].filter(
      (id): id is string => Boolean(id),
    ),
  );

/** Quem o inimigo dessa rota é, para efeito de confronto direto. */
function directOpponent(role: Role, enemies: TeamSlots): string | null {
  return enemies[role];
}

/**
 * O que falta na sua composição. Cada eixo vira um bônus para quem preenche.
 * Composição sem frente de batalha perde luta em grupo mesmo com muito dano.
 */
function teamNeeds(allies: ChampionRef[]) {
  const total = allies.length || 1;
  const physical = allies.reduce((s, c) => s + weightOf(c, "AD_DAMAGE"), 0);
  const magic = allies.reduce((s, c) => s + weightOf(c, "AP_DAMAGE"), 0);
  const damageTotal = physical + magic || 1;

  return {
    /** 0..1 — o quanto o time precisa de dano mágico */
    needsMagic: Math.max(0, 0.5 - magic / damageTotal) * 2,
    needsPhysical: Math.max(0, 0.5 - physical / damageTotal) * 2,
    needsFrontline:
      allies.filter((c) => weightOf(c, "TANK") >= 0.6 || weightOf(c, "BRUISER") >= 0.6).length === 0
        ? 1
        : 0,
    needsEngage: allies.filter((c) => weightOf(c, "ENGAGE") >= 0.5).length === 0 ? 1 : 0,
    needsCc: allies.filter((c) => weightOf(c, "HARD_CC") >= 0.6).length < 2 ? 1 : 0,
    empty: allies.length === 0,
  };
}

/**
 * Combinação da rota de baixo. Atirador frágil pede suporte que protege;
 * atirador de all-in pede suporte que inicia.
 */
function botLaneSynergy(candidate: ChampionRef, partner: ChampionRef | undefined, role: Role) {
  if (!partner) return { bonus: 0, reason: null as string | null };

  const isSupportPick = role === "SUPPORT";
  const adc = isSupportPick ? partner : candidate;
  const support = isSupportPick ? candidate : partner;

  const adcFragile = weightOf(adc, "SQUISHY") >= 0.6 && weightOf(adc, "IMMOBILE") >= 0.6;
  const supportProtects = weightOf(support, "SHIELD") >= 0.5 || weightOf(support, "TEAM_HEAL") >= 0.5;
  const supportEngages = weightOf(support, "ENGAGE") >= 0.5 || weightOf(support, "HARD_CC") >= 0.7;
  const adcAllIn = weightOf(adc, "ALL_IN") >= 0.5 || weightOf(adc, "SUSTAINED_DPS") >= 0.7;

  // a frase sempre cita o PARCEIRO, nunca o próprio candidato
  if (adcFragile && supportProtects)
    return {
      bonus: 1.6,
      reason: isSupportPick
        ? `Protege ${adc.name}, que não tem como escapar sozinho`
        : `${support.name} te protege, e você precisa disso`,
    };
  if (adcAllIn && supportEngages)
    return {
      bonus: 1.4,
      reason: `Boa dupla com ${partner.name}: um prende, o outro converte`,
    };
  if (adcFragile && !supportProtects && !supportEngages)
    return {
      bonus: -0.8,
      reason: `Dupla desprotegida ao lado de ${partner.name}`,
    };
  return { bonus: 0, reason: null };
}

export function suggestPicks({
  role,
  board,
  catalog,
  limit = 6,
}: {
  role: Role;
  board: DraftBoard;
  catalog: MatchupCatalog;
  limit?: number;
}): PickSuggestion[] {
  const taken = takenIds(board);
  const opponentId = directOpponent(role, board.enemies);

  const allyChampions = Object.entries(board.allies)
    .filter(([r]) => r !== role)
    .map(([, id]) => (id ? catalog.champions.get(id) : undefined))
    .filter((c): c is ChampionRef => Boolean(c));
  const needs = teamNeeds(allyChampions);

  const partnerId =
    role === "ADC" ? board.allies.SUPPORT : role === "SUPPORT" ? board.allies.ADC : null;
  const partner = partnerId ? catalog.champions.get(partnerId) : undefined;

  const enemyChampions = Object.values(board.enemies)
    .map((id) => (id ? catalog.champions.get(id) : undefined))
    .filter((c): c is ChampionRef => Boolean(c));

  const suggestions: PickSuggestion[] = [];

  for (const champion of catalog.champions.values()) {
    if (taken.has(champion.id)) continue;
    if (!champion.positions.includes(role)) continue;

    const reasons: string[] = [];
    let score = 0;
    const fit = roleFit(champion, role);

    // 1) confronto direto — o sinal mais forte quando o inimigo já escolheu
    let counterScore = 0;
    if (opponentId) {
      const matchup = analyzeMatchup(
        {
          selfChampionId: champion.id,
          enemyChampionId: opponentId,
          allyJungleId: board.allies.JUNGLE,
          enemyJungleId: board.enemies.JUNGLE,
        },
        catalog,
      );
      counterScore = matchup.score;
      score += counterScore * ROLE_MODEL[role].blindWeight * 0.8;
      // limiar baixo de propósito: saber como fica o confronto é a informação
      // mais útil da tela, e antes ela quase nunca aparecia
      const opponentName = catalog.champions.get(opponentId)?.name;
      if (counterScore >= 1.2)
        reasons.push(`Vence a rota contra ${opponentName} (+${matchup.score})`);
      else if (counterScore <= -1.2)
        reasons.push(`Perde a rota para ${opponentName} (${matchup.score})`);
      else reasons.push(`Rota equilibrada contra ${opponentName}`);
    } else {
      // inimigo ainda não escolheu: vale quem é seguro contra a rota inteira
      const blind = blindPickScore(champion, role, catalog);
      score += blind * ROLE_MODEL[role].blindWeight;
      if (blind >= 0.8)
        reasons.push(
          `Confronto médio favorável na rota (${blind > 0 ? "+" : ""}${Math.round(blind * 10) / 10}) — seguro de pegar antes do inimigo`,
        );
      else if (blind <= -0.8)
        reasons.push(
          `Confronto médio desfavorável na rota (${Math.round(blind * 10) / 10}) — arriscado sem saber o que vem`,
        );
    }

    // 1b) confronto contra outros inimigos já selecionados
    for (const enemyRole of ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"] as Role[]) {
      if (enemyRole === role) continue; // já tratado pelo opponentId
      const eId = board.enemies[enemyRole];
      if (!eId) continue;
      
      const matchup = analyzeMatchup(
        {
          selfChampionId: champion.id,
          enemyChampionId: eId,
          allyJungleId: null,
          enemyJungleId: null,
        },
        catalog,
      );
      
      const teamWeight = ROLE_MODEL[role].blindWeight * 0.4; // impacto menor que a própria rota
      score += matchup.score * teamWeight;
      counterScore += matchup.score * 0.5; 
      
      const enemyName = catalog.champions.get(eId)?.name;
      if (matchup.score >= 2.0) {
        reasons.push(`Bom contra ${enemyName} (+${matchup.score})`);
      } else if (matchup.score <= -2.0) {
        reasons.push(`Sofre contra ${enemyName} (${matchup.score})`);
      }
    }

    // 2) o que falta no seu time
    //
    // Estes bônus se somavam sem limite e faziam o Yasuo aparecer como melhor
    // atirador: ele marcava dano de ataque, iniciação e controle ao mesmo tempo.
    // O teto garante que "tapar buracos" nunca supere ser bom na função.
    if (!needs.empty) {
      let needScore = 0;
      const magic = weightOf(champion, "AP_DAMAGE");
      const physical = weightOf(champion, "AD_DAMAGE");
      if (needs.needsMagic > 0.4 && magic >= 0.6) {
        needScore += 1.2 * needs.needsMagic;
        reasons.push("Seu time está sem dano mágico — o inimigo só precisaria de armadura");
      }
      if (needs.needsPhysical > 0.4 && physical >= 0.6) {
        needScore += 1.2 * needs.needsPhysical;
        reasons.push("Seu time está sem dano de ataque");
      }
      if (needs.needsFrontline && weightOf(champion, "TANK") >= 0.6) {
        needScore += 1.4;
        reasons.push("Seu time não tem ninguém para segurar a frente");
      }
      if (needs.needsEngage && weightOf(champion, "ENGAGE") >= 0.5) {
        needScore += 1;
        reasons.push("Seu time não tem quem inicie a luta");
      }
      if (needs.needsCc && weightOf(champion, "HARD_CC") >= 0.7) {
        needScore += 0.7;
        reasons.push("Adiciona controle de grupo, que falta no seu time");
      }
      // Um campeão fora de função costuma marcar vários buracos de uma vez —
      // e marca justamente porque não é daquela rota. Yasuo "traz iniciação e
      // controle" para a rota do atirador porque ele não é um atirador.
      score += Math.min(2.5, needScore) * (fit < -1 ? 0.35 : 1);
    }

    // 3) dupla de rota
    const synergy = botLaneSynergy(champion, partner, role);
    score += synergy.bonus;
    if (synergy.reason) reasons.push(synergy.reason);

    // 4) responde à composição inimiga como um todo
    const enemyHealers = enemyChampions.filter(
      (c) => weightOf(c, "SELF_HEAL") >= 0.5 || weightOf(c, "TEAM_HEAL") >= 0.5,
    ).length;
    if (enemyHealers >= 2 && weightOf(champion, "TRUE_DAMAGE") >= 0.5) {
      score += 0.8;
      reasons.push("Dano verdadeiro resolve time que se cura muito");
    }
    const enemyImmobile = enemyChampions.filter((c) => weightOf(c, "IMMOBILE") >= 0.7).length;
    if (enemyImmobile >= 2 && weightOf(champion, "ENGAGE") >= 0.5) {
      score += 0.8;
      reasons.push(`${enemyImmobile} inimigos não têm fuga — iniciar neles é de graça`);
    }

    // 5) o kit combina com a função da rota?
    score += fit;
    if (fit >= 1) {
      const axis =
        role === "SUPPORT"
          ? "utilidade e controle para proteger a dupla"
          : role === "JUNGLE"
            ? "mobilidade e controle para chegar nas rotas"
            : role === "ADC"
              ? "dano sustentado, que é o que a rota exige"
              : "o perfil que a rota pede";
      reasons.push(`Tem ${axis}`);
    }

    // 6) desempate suave por facilidade: numa escolha apertada, pegue o mais simples
    if (champion.difficulty === 1) score += 0.15;
    if (champion.difficulty === 3) score -= 0.15;

    if (!reasons.length) {
      const blind = opponentId ? 0 : blindPickScore(champion, role, catalog);
      reasons.push(
        opponentId
          ? `Confronto equilibrado contra ${catalog.champions.get(opponentId)?.name}`
          : `Confronto médio na rota: ${blind > 0 ? "+" : ""}${Math.round(blind * 10) / 10}`,
      );
    }

    suggestions.push({
      champion,
      score: Math.round(score * 10) / 10,
      reasons: reasons.slice(0, 3),
      counterScore,
    });
  }

  return suggestions.sort((a, b) => b.score - a.score).slice(0, limit);
}

/* ------------------------------------------------------------- chances */

export type WinEstimate = {
  /** 0..100 — leitura da composição, não taxa de vitória real */
  chance: number;
  label: string;
  factors: { label: string; delta: number }[];
  confidence: "BAIXA" | "MÉDIA" | "ALTA";
};

/**
 * Estimativa de vantagem da composição.
 *
 * Não é taxa de vitória: é a soma dos confrontos de rota conhecidos mais o
 * equilíbrio da composição, convertida numa escala de 0 a 100. Serve para
 * responder "estou na frente ou atrás?", não para prever a partida.
 */
export function estimateWinChance(board: DraftBoard, catalog: MatchupCatalog): WinEstimate {
  const factors: { label: string; delta: number }[] = [];
  let known = 0;

  const ROLE_ORDER: Role[] = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];
  for (const role of ROLE_ORDER) {
    const ally = board.allies[role];
    const enemy = board.enemies[role];
    if (!ally || !enemy) continue;
    known++;

    const matchup = analyzeMatchup(
      {
        selfChampionId: ally,
        enemyChampionId: enemy,
        allyJungleId: board.allies.JUNGLE,
        enemyJungleId: board.enemies.JUNGLE,
      },
      catalog,
    );
    // uma rota vale conforme o duelo decide aquela rota: topo e meio são 1
    // contra 1 de verdade; suporte e selva, não. Sem isso, "Lulu perde para
    // Leona" pesava tanto quanto "Orianna perde para Zed".
    const weight = ROLE_MODEL[role].blindWeight / 2;
    const delta = matchup.score * weight;

    if (Math.abs(delta) >= 0.5) {
      factors.push({
        label: `${ROLE_LABEL[role]}: ${catalog.champions.get(ally)?.name} contra ${catalog.champions.get(enemy)?.name}`,
        delta,
      });
    }
  }

  const allies = Object.values(board.allies)
    .map((id) => (id ? catalog.champions.get(id) : undefined))
    .filter((c): c is ChampionRef => Boolean(c));
  const enemies = Object.values(board.enemies)
    .map((id) => (id ? catalog.champions.get(id) : undefined))
    .filter((c): c is ChampionRef => Boolean(c));

  const compare = (slug: string, min: number, label: string, weight: number) => {
    const mine = allies.filter((c) => weightOf(c, slug) >= min).length;
    const theirs = enemies.filter((c) => weightOf(c, slug) >= min).length;
    if (mine === theirs) return;
    factors.push({ label, delta: (mine - theirs) * weight });
  };

  compare("TANK", 0.6, "Frente de batalha", 0.8);
  compare("HARD_CC", 0.7, "Controle de grupo", 0.5);
  compare("ENGAGE", 0.5, "Capacidade de iniciar", 0.5);
  compare("SCALING", 0.6, "Força no fim de jogo", 0.4);

  const raw = factors.reduce((sum, f) => sum + f.delta, 0);
  // cada ponto vale ~2,5% e o resultado fica preso entre 25 e 75: composição
  // pesa, mas quem joga melhor ganha — prometer mais que isso seria mentira
  const chance = Math.max(25, Math.min(75, Math.round(50 + raw * 2.5)));

  const confidence = known >= 4 ? "ALTA" : known >= 2 ? "MÉDIA" : "BAIXA";
  const label =
    chance >= 65
      ? "Composição a seu favor"
      : chance >= 55
        ? "Leve vantagem"
        : chance > 45
          ? "Equilibrado"
          : chance > 35
            ? "Leve desvantagem"
            : "Composição contra você";

  return {
    chance,
    label,
    factors: factors.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 6),
    confidence,
  };
}
