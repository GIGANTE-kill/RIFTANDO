/**
 * Plano de ação para os próximos minutos. Muda com a fase do jogo: o que
 * decide aos 8 minutos não é o que decide aos 30.
 */
import type { MatchupAnalysis } from "./matchup";
import type { Phase, Role, TeamAnalysis } from "./match";
import { PHASE_FOCUS, ROLE_LABEL } from "./match";
import type { ChampionRef } from "./types";

export type PlanStep = { title: string; detail: string };

const weightOf = (champion: ChampionRef | undefined, slug: string) =>
  (champion?.tags.find((t) => t.slug === slug)?.weight ?? 0) / 100;

export function buildGamePlan({
  phase,
  role,
  me,
  matchup,
  enemyTeam,
}: {
  phase: Phase;
  role: Role;
  me?: ChampionRef;
  matchup: MatchupAnalysis;
  enemyTeam: TeamAnalysis;
}): PlanStep[] {
  const iScale = weightOf(me, "SCALING") >= 0.6;
  const iAmEarly = weightOf(me, "EARLY_GAME") >= 0.6;
  const iAmFragile = weightOf(me, "SQUISHY") >= 0.6;
  const enemyEngage = enemyTeam.champions.filter((c) => weightOf(c, "ENGAGE") >= 0.5);
  const topThreat = enemyTeam.threats[0]?.champion;

  if (phase === "ROTAS") {
    // na fase de rotas o confronto direto é o que manda: reaproveita o plano do
    // motor de matchup e só acrescenta o alerta de composição
    const steps = [...matchup.plan];
    if (enemyTeam.warnings.length) {
      steps[2] = {
        title: "Já pense no item que você vai precisar",
        detail: enemyTeam.warnings[0],
      };
    }
    return steps;
  }

  if (phase === "MEIO") {
    return [
      {
        title: enemyEngage.length
          ? `Não ande sozinho por corredor sem visão`
          : "Pressione as rotas laterais entre os objetivos",
        detail: enemyEngage.length
          ? `${enemyEngage.map((c) => c.name).join(" e ")} ${enemyEngage.length > 1 ? "iniciam" : "inicia"} luta de graça em quem estiver isolado. Ande com um aliado ou com visão colocada à frente.`
          : "O time inimigo tem pouca capacidade de te pegar sozinho. Use isso para empurrar as laterais e voltar para os objetivos.",
      },
      {
        title: "Coloque visão antes do dragão, não depois",
        detail:
          "Sentinela no rio 30 segundos antes do objetivo nascer. Visão colocada depois que a luta começa não serve para nada.",
      },
      iScale
        ? {
            title: "Farme entre as jogadas",
            detail:
              "Você fica mais forte com itens. Cada onda de minions que você deixa morrer sozinha atrasa o momento em que você decide a partida.",
          }
        : {
            title: topThreat
              ? `Force o jogo enquanto ${topThreat.name} não tem itens`
              : "Force o jogo agora",
            detail:
              "Sua vantagem é maior agora do que será depois. Troque pressão por torre e por dragão em vez de esperar.",
          },
    ];
  }

  // FIM
  return [
    {
      title: iAmFragile ? "Fique atrás de todo mundo" : "Seja o primeiro a entrar, mas com propósito",
      detail: iAmFragile
        ? `Você morre se for pego${topThreat ? ` — principalmente por ${topThreat.name}` : ""}. Só entre depois que a habilidade de iniciar do inimigo for usada.`
        : "Inicie apenas quando seu time estiver junto e com visão do Barão. Iniciar sozinho entrega a partida.",
    },
    {
      title: enemyTeam.healingSources.length
        ? "Garanta que alguém tenha corta-cura"
        : "Não lute sem visão do Barão",
      detail: enemyTeam.healingSources.length
        ? `${enemyTeam.healingSources.map((c) => c.name).join(", ")} devolve vida no meio da luta. Sem Feridas Graves aplicadas, o dano do seu time não fecha.`
        : "Uma luta perdida agora custa a partida. Coloque visão e force o inimigo a começar em desvantagem.",
    },
    {
      title: iAmEarly
        ? "Converta agora, seu pico já passou"
        : "Espere o erro em vez de criar o seu",
      detail: iAmEarly
        ? "Seu campeão era mais forte antes. Force objetivo com o time junto em vez de esperar o fim de jogo."
        : `${PHASE_FOCUS.FIM}`,
    },
  ];
}
