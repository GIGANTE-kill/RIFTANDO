/**
 * Motor de matchup de rota. Determinístico e auditável: cada ponto de vantagem
 * vem de um confronto de tags que a saída consegue nomear.
 *
 *   meu campeão × inimigo direto (+ selvas) → vantagem, diretrizes, plano
 */
import type { StatsIndex } from "./stats";
import { TAG_CATALOG, tagLabel } from "./tag-catalog";
import type { ChampionRef } from "./types";

/** Tags de alcance já são cobertas pelo cálculo numérico — ver `rangeContribution`. */
const RANGE_TAGS = new Set(
  TAG_CATALOG.filter((t) => t.category === "RANGE").map((t) => t.slug as string),
);

export type MatchupTagRuleRef = {
  id: number;
  selfTagSlug: string;
  enemyTagSlug: string;
  advantage: number; // -5..+5
  guideline: string;
  phase: "EARLY" | "MID" | "LATE" | "ANY";
};

export type MatchupOverrideRef = {
  selfChampionId: string;
  enemyChampionId: string;
  advantage: number;
  guideline: string;
};

export type MatchupCatalog = {
  champions: Map<string, ChampionRef>;
  tagRules: MatchupTagRuleRef[];
  overrides: MatchupOverrideRef[];
  /** partidas reais coletadas — quando existem, o draft as soma às regras */
  stats?: StatsIndex;
};

export type LaneState = {
  selfChampionId: string | null;
  enemyChampionId: string | null;
  /** selvas: mudam o risco de gank, não a vantagem de rota em si */
  allyJungleId: string | null;
  enemyJungleId: string | null;
};

export type Contribution = {
  label: string;
  advantage: number;
  guideline: string;
  /** o quanto as tags envolvidas são fortes nos dois campeões (0..1) */
  confidence: number;
};

export type Verdict =
  | "MUITO_FAVORAVEL"
  | "FAVORAVEL"
  | "EQUILIBRADO"
  | "DESFAVORAVEL"
  | "MUITO_DESFAVORAVEL";

export type MatchupAnalysis = {
  self?: ChampionRef;
  enemy?: ChampionRef;
  /** -10..+10 */
  score: number;
  verdict: Verdict;
  isOverride: boolean;
  contributions: Contribution[];
  gankRisk: { level: "BAIXO" | "MÉDIO" | "ALTO"; reason: string };
  plan: { title: string; detail: string }[];
};

const tagWeight = (champion: ChampionRef | undefined, slug: string) =>
  (champion?.tags.find((t) => t.slug === slug)?.weight ?? 0) / 100;

const VERDICT_LABEL: Record<Verdict, string> = {
  MUITO_FAVORAVEL: "Muito favorável",
  FAVORAVEL: "Favorável",
  EQUILIBRADO: "Equilibrado",
  DESFAVORAVEL: "Desfavorável",
  MUITO_DESFAVORAVEL: "Muito desfavorável",
};

export const verdictLabel = (v: Verdict) => VERDICT_LABEL[v];

function toVerdict(score: number): Verdict {
  if (score >= 4) return "MUITO_FAVORAVEL";
  if (score >= 1.5) return "FAVORAVEL";
  if (score > -1.5) return "EQUILIBRADO";
  if (score > -4) return "DESFAVORAVEL";
  return "MUITO_DESFAVORAVEL";
}

/**
 * Alcance é a única vantagem de rota que não precisa de regra: é aritmética.
 * Cada 125 de diferença ≈ 1 ponto, limitado a ±2 para não dominar o resultado.
 */
/**
 * O quanto o campeão converte alcance em pressão de rota. Um atirador assedia
 * com auto-ataque; um mago assedia com habilidade — para ele o alcance de ataque
 * diz muito menos, e contá-lo cheio inflava confrontos como Lux x Zed.
 */
function autoAttackDependence(champion: ChampionRef): number {
  return Math.max(
    tagWeight(champion, "SUSTAINED_DPS"),
    champion.classes.includes("Marksman") ? 0.9 : 0,
    0.35,
  );
}

function rangeContribution(self: ChampionRef, enemy: ChampionRef): Contribution | null {
  const delta = self.attackRange - enemy.attackRange;
  if (Math.abs(delta) < 60) return null; // diferença irrelevante na prática

  // quem tem o alcance só lucra se souber usá-lo
  const dependence = autoAttackDependence(delta > 0 ? self : enemy);
  const advantage = Math.max(-3, Math.min(3, delta / 110)) * dependence;
  const label =
    delta > 0
      ? `Alcance a seu favor (${self.attackRange} contra ${enemy.attackRange})`
      : `Alcance contra você (${self.attackRange} contra ${enemy.attackRange})`;

  return {
    label,
    advantage,
    guideline:
      delta > 0
        ? "Negue o farm com auto-ataques enquanto ele precisa entrar no seu alcance. Seu erro típico é chegar perto demais do CS."
        : "Você paga dano só para farmar. Use habilidades para o CS de longe e só troque com o feitiço dele em recarga.",
    confidence: 1,
  };
}

/**
 * Quanto do kit do campeão de menor alcance realmente encosta no outro.
 *
 * Sem isso o motor conta "SQUISHY contra ALL_IN" com peso cheio num confronto
 * onde o inimigo tem 325 de alcance a menos e nenhum dash — era o que invertia
 * Teemo x Darius. Um dash ou blink devolve a ameaça ao peso original.
 */
function reachFactor(shorter: ChampionRef, gap: number): number {
  if (gap <= 150) return 1;
  const closing = Math.max(
    tagWeight(shorter, "DASH"),
    tagWeight(shorter, "BLINK"),
    tagWeight(shorter, "ENGAGE"),
  );
  const penalty = Math.min(1, (gap - 150) / 400) * (1 - closing);
  return Math.max(0.25, 1 - penalty);
}

function gankRisk(state: LaneState, catalog: MatchupCatalog, self?: ChampionRef) {
  const enemyJungle = state.enemyJungleId
    ? catalog.champions.get(state.enemyJungleId)
    : undefined;
  if (!enemyJungle) {
    return { level: "MÉDIO" as const, reason: "Selva inimiga não informada." };
  }

  const jungleCc = Math.max(
    tagWeight(enemyJungle, "HARD_CC"),
    tagWeight(enemyJungle, "DISPLACEMENT"),
  );
  const jungleEngage = Math.max(tagWeight(enemyJungle, "ENGAGE"), tagWeight(enemyJungle, "DASH"));
  const selfEscape = Math.max(
    tagWeight(self, "DASH"),
    tagWeight(self, "BLINK"),
    tagWeight(self, "DISENGAGE"),
  );
  const immobile = tagWeight(self, "IMMOBILE");

  const risk = jungleCc * 0.5 + jungleEngage * 0.3 + immobile * 0.4 - selfEscape * 0.3;

  if (risk >= 0.6)
    return {
      level: "ALTO" as const,
      reason: `${enemyJungle.name} tem CC confiável e você tem pouca saída. Não passe da metade da wave sem visão no rio.`,
    };
  if (risk >= 0.3)
    return {
      level: "MÉDIO" as const,
      reason: `${enemyJungle.name} pode punir posicionamento agressivo. Mantenha um ward de rio quando empurrar.`,
    };
  return {
    level: "BAIXO" as const,
    reason: `${enemyJungle.name} tem pouco CC para converter um gank. Você pode empurrar com mais liberdade.`,
  };
}

/** Plano em 3 passos: rota → wave → mapa. Determinístico, derivado do veredito. */
function buildPlan(
  verdict: Verdict,
  contributions: Contribution[],
  risk: ReturnType<typeof gankRisk>,
  self?: ChampionRef,
  enemy?: ChampionRef,
): MatchupAnalysis["plan"] {
  const strongest = contributions[0];
  const iScale = tagWeight(self, "SCALING") >= 0.6;
  const enemyScales = tagWeight(enemy, "SCALING") >= 0.6;

  const waveByVerdict: Record<Verdict, { title: string; detail: string }> = {
    MUITO_FAVORAVEL: {
      title: "Empurre e negue o farm",
      detail:
        "Mantenha a wave em cima da torre dele. Cada onda que ele perde sob pressão é ouro e experiência que não voltam.",
    },
    FAVORAVEL: {
      title: "Wave adiantada, mas com visão",
      detail:
        "Empurre para forçar erro dele, sem passar do rio sem ward. Sua vantagem é frágil se a selva inimiga aparecer.",
    },
    EQUILIBRADO: {
      title: "Wave no meio da rota",
      detail:
        "Nenhum dos dois tem janela clara. Farme parelho e deixe a decisão para a primeira rotação de selva.",
    },
    DESFAVORAVEL: {
      title: "Congele perto da sua torre",
      detail:
        "Puxe a wave para o seu lado e farme em segurança. Ele precisa se expor para pressionar você ali.",
    },
    MUITO_DESFAVORAVEL: {
      title: "Farm seguro, aceite perder CS",
      detail:
        "Não troque: sobreviver e chegar ao seu segundo item vale mais do que 15 de CS. Peça uma rotação da sua selva.",
    },
  };

  const mapStep = enemyScales
    ? {
        title: "Force o jogo antes que ele cresça",
        detail: `${enemy?.name ?? "O inimigo"} fica mais forte com o tempo. Converta qualquer vantagem em torre ou objetivo antes dos 20 minutos.`,
      }
    : iScale
      ? {
          title: "Chegue aos itens",
          detail:
            "Sua curva vira o jogo depois. Priorize farm constante e evite lutas 50/50 que não trazem objetivo.",
        }
      : {
          title: "Jogue pelo mapa",
          detail:
            risk.level === "ALTO"
              ? "Com o risco de gank alto, roame quando a wave estiver empurrada e mantenha visão nos dois arbustos do rio."
              : "Aproveite as janelas de recall dele para pressionar objetivos ou ajudar a rota vizinha.",
        };

  return [
    strongest
      ? { title: strongest.label, detail: strongest.guideline }
      : {
          title: "Sem confronto de tags conhecido",
          detail:
            "Nenhuma regra cobriu esse par. Jogue pelo padrão: respeite o alcance maior e observe as recargas dele.",
        },
    waveByVerdict[verdict],
    mapStep,
  ];
}

export function analyzeMatchup(state: LaneState, catalog: MatchupCatalog): MatchupAnalysis {
  const self = state.selfChampionId ? catalog.champions.get(state.selfChampionId) : undefined;
  const enemy = state.enemyChampionId ? catalog.champions.get(state.enemyChampionId) : undefined;

  const risk = gankRisk(state, catalog, self);

  if (!self || !enemy) {
    return {
      self,
      enemy,
      score: 0,
      verdict: "EQUILIBRADO",
      isOverride: false,
      contributions: [],
      gankRisk: risk,
      plan: buildPlan("EQUILIBRADO", [], risk, self, enemy),
    };
  }

  // override curado vence tudo: existe justamente para os pares que as tags erram
  const override = catalog.overrides.find(
    (o) => o.selfChampionId === self.id && o.enemyChampionId === enemy.id,
  );

  const contributions: Contribution[] = [];
  const rangeEdge = rangeContribution(self, enemy);
  if (rangeEdge) contributions.push(rangeEdge);

  for (const rule of catalog.tagRules) {
    // "RANGED_LONG contra MELEE_SHORT" e a diferença numérica de alcance são o
    // mesmo fato. Somar os dois inflava o placar — o número é mais preciso.
    if (RANGE_TAGS.has(rule.selfTagSlug) && RANGE_TAGS.has(rule.enemyTagSlug)) continue;

    const selfW = tagWeight(self, rule.selfTagSlug);
    const enemyW = tagWeight(enemy, rule.enemyTagSlug);
    if (selfW === 0 || enemyW === 0) continue;

    // uma tag fraca dos dois lados não deve pesar como uma forte dos dois
    const confidence = selfW * enemyW;
    contributions.push({
      // nunca mostre o código interno da tag na tela
      label: `Você "${tagLabel(rule.selfTagSlug)}" contra "${tagLabel(rule.enemyTagSlug)}"`,
      advantage: rule.advantage * confidence,
      guideline: rule.guideline,
      confidence,
    });
  }

  // O lado de menor alcance precisa encostar para que suas tags valham.
  // A diferença de alcance em si (rangeEdge) não é afetada: ela já é o fato.
  const gap = Math.abs(self.attackRange - enemy.attackRange);
  if (gap > 150) {
    const selfOutranges = self.attackRange > enemy.attackRange;
    const factor = reachFactor(selfOutranges ? enemy : self, gap);
    for (const c of contributions) {
      if (c === rangeEdge) continue;
      // se eu tenho o alcance, as ameaças dele encolhem; se ele tem, as minhas
      const gated = selfOutranges ? c.advantage < 0 : c.advantage > 0;
      if (gated) c.advantage *= factor;
    }
  }

  contributions.sort((a, b) => Math.abs(b.advantage) - Math.abs(a.advantage));

  const raw = contributions.reduce((sum, c) => sum + c.advantage, 0);
  const score = override ? override.advantage : Math.max(-10, Math.min(10, raw));
  const verdict = toVerdict(score);

  if (override) {
    contributions.unshift({
      label: `Confronto curado: ${self.name} contra ${enemy.name}`,
      advantage: override.advantage,
      guideline: override.guideline,
      confidence: 1,
    });
  }

  return {
    self,
    enemy,
    score: Math.round(score * 10) / 10,
    verdict,
    isOverride: Boolean(override),
    contributions,
    gankRisk: risk,
    plan: buildPlan(verdict, contributions, risk, self, enemy),
  };
}
