/**
 * Motor de partida: junta rotas, composição de time e momento do jogo.
 *
 * É a camada que responde "contra quem eu estou jogando agora e o que muda
 * daqui pra frente", em cima dos motores de matchup e itemização.
 */
import { tagLabel } from "./tag-catalog";
import type { ChampionRef } from "./types";

export const ROLES = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  TOP: "Topo",
  JUNGLE: "Selva",
  MID: "Meio",
  ADC: "Atirador",
  SUPPORT: "Suporte",
};

export const ROLE_HINT: Record<Role, string> = {
  TOP: "Rota de cima, geralmente 1 contra 1",
  JUNGLE: "Sem rota fixa: farma a selva e ajuda as rotas",
  MID: "Rota do meio, geralmente 1 contra 1",
  ADC: "Rota de baixo, joga junto com o suporte",
  SUPPORT: "Rota de baixo, joga junto com o atirador",
};

export type TeamSlots = Record<Role, string | null>;

export const EMPTY_TEAM: TeamSlots = {
  TOP: null,
  JUNGLE: null,
  MID: null,
  ADC: null,
  SUPPORT: null,
};

/** Fases do jogo, em minutos. */
export type Phase = "ROTAS" | "MEIO" | "FIM";

export const PHASE_LABEL: Record<Phase, string> = {
  ROTAS: "Fase de rotas",
  MEIO: "Meio de jogo",
  FIM: "Fim de jogo",
};

export function phaseAt(minute: number): Phase {
  if (minute < 14) return "ROTAS";
  if (minute < 26) return "MEIO";
  return "FIM";
}

export const PHASE_FOCUS: Record<Phase, string> = {
  ROTAS:
    "As rotas ainda estão separadas. O que decide agora é farm, controle da onda de minions e não morrer para gank.",
  MEIO:
    "As torres externas começam a cair e o time se agrupa. O que decide agora é visão, dragão e pegar o inimigo isolado.",
  FIM:
    "Uma morte custa a partida. O que decide agora é posicionamento em grupo, Barão e não iniciar luta sem visão.",
};

/**
 * Contra quem você realmente joga.
 *
 * Topo, selva e meio enfrentam a mesma rota. A rota de baixo é 2 contra 2:
 * o atirador tem o atirador inimigo como alvo principal e o suporte como a
 * segunda ameaça — e vice-versa.
 */
export function opponentsFor(role: Role, enemies: TeamSlots): {
  primary: string | null;
  secondary: string | null;
  explanation: string;
} {
  switch (role) {
    case "ADC":
      return {
        primary: enemies.ADC,
        secondary: enemies.SUPPORT,
        explanation:
          "Você joga a rota de baixo 2 contra 2: o atirador inimigo é quem disputa o farm com você, e o suporte é quem inicia as trocas.",
      };
    case "SUPPORT":
      return {
        primary: enemies.SUPPORT,
        secondary: enemies.ADC,
        explanation:
          "Você joga a rota de baixo 2 contra 2: o suporte inimigo é seu confronto direto, mas quem vai te matar é o atirador.",
      };
    case "JUNGLE":
      return {
        primary: enemies.JUNGLE,
        secondary: null,
        explanation:
          "Você disputa a selva com o caçador inimigo: os mesmos campos, os mesmos objetivos e o mesmo tempo de recarga.",
      };
    default:
      return {
        primary: enemies[role],
        secondary: enemies.JUNGLE,
        explanation:
          `Você enfrenta ${ROLE_LABEL[role].toLowerCase()} contra ${ROLE_LABEL[role].toLowerCase()}. A selva inimiga é a segunda ameaça: ela decide se a sua rota vira.`,
      };
  }
}

const weightOf = (champion: ChampionRef | undefined, slug: string) =>
  (champion?.tags.find((t) => t.slug === slug)?.weight ?? 0) / 100;

export type TeamAnalysis = {
  champions: ChampionRef[];
  /** 0..100 — quanto do dano do time é de ataque (o resto é mágico) */
  physicalShare: number;
  damageVerdict: string;
  healingSources: ChampionRef[];
  shieldSources: ChampionRef[];
  hardCcSources: ChampionRef[];
  tanks: ChampionRef[];
  /** ordenados por perigo para você */
  threats: { champion: ChampionRef; danger: number; why: string }[];
  warnings: string[];
};

/**
 * Perigo de um inimigo para você: quanto ele mata rápido, quanto ele te prende
 * e o quanto você é frágil contra o tipo de dano dele.
 */
function dangerOf(enemy: ChampionRef, me: ChampionRef | undefined): { danger: number; why: string } {
  const burst = weightOf(enemy, "BURST");
  const dps = weightOf(enemy, "SUSTAINED_DPS");
  const cc = Math.max(weightOf(enemy, "HARD_CC"), weightOf(enemy, "DISPLACEMENT"));
  const reach = Math.max(weightOf(enemy, "DASH"), weightOf(enemy, "BLINK"), weightOf(enemy, "ENGAGE"));
  const trueDamage = weightOf(enemy, "TRUE_DAMAGE");
  const myFragility = Math.max(weightOf(me, "SQUISHY"), weightOf(me, "IMMOBILE") * 0.7);

  const danger =
    burst * 3 + dps * 2 + cc * 1.5 + reach * 1.2 + trueDamage * 1.5 + myFragility * 2 * (burst + reach);

  const reasons: string[] = [];
  if (burst >= 0.6) reasons.push("mata numa sequência curta");
  if (dps >= 0.6) reasons.push("dano contínuo alto");
  if (cc >= 0.6) reasons.push("prende de verdade");
  if (reach >= 0.6) reasons.push("fecha distância fácil");
  if (trueDamage >= 0.5) reasons.push("dano que ignora defesa");

  return {
    danger: Math.round(danger * 10) / 10,
    why: reasons.length ? reasons.join(", ") : "ameaça padrão para a rota",
  };
}

export function analyzeTeam(
  championIds: (string | null)[],
  champions: Map<string, ChampionRef>,
  me?: ChampionRef,
): TeamAnalysis {
  const list = championIds
    .filter((id): id is string => Boolean(id))
    .map((id) => champions.get(id))
    .filter((c): c is ChampionRef => Boolean(c));

  const withTag = (slug: string, min = 0.5) => list.filter((c) => weightOf(c, slug) >= min);

  const physical = list.reduce((sum, c) => sum + weightOf(c, "AD_DAMAGE"), 0);
  const magic = list.reduce((sum, c) => sum + weightOf(c, "AP_DAMAGE"), 0);
  const total = physical + magic;
  const physicalShare = total === 0 ? 50 : Math.round((physical / total) * 100);

  let damageVerdict: string;
  if (!list.length) damageVerdict = "Escolha os inimigos para ver de onde vem o dano deles.";
  else if (physicalShare >= 70)
    damageVerdict =
      "O time inimigo é quase todo dano de ataque. Armadura é o que te protege — resistência mágica seria ouro jogado fora.";
  else if (physicalShare <= 30)
    damageVerdict =
      "O time inimigo é quase todo dano mágico. Resistência mágica é o que te protege — armadura ajudaria pouco.";
  else
    damageVerdict =
      "O dano inimigo é misto. Vida te protege dos dois lados; compre a defesa específica contra quem estiver mais forte na partida.";

  const healingSources = withTag("SELF_HEAL").concat(withTag("TEAM_HEAL")).concat(withTag("LIFESTEAL_SCALING"));
  const uniqueHealing = [...new Map(healingSources.map((c) => [c.id, c])).values()];

  const warnings: string[] = [];
  if (uniqueHealing.length >= 2)
    warnings.push(
      `${uniqueHealing.length} inimigos se curam (${uniqueHealing.map((c) => c.name).join(", ")}). Sem um item que corta cura, lutas longas viram contra você.`,
    );
  const cc = withTag("HARD_CC");
  if (cc.length >= 3)
    warnings.push(
      `${cc.length} inimigos prendem de verdade. Tenacidade ou Remover encurta o tempo que você fica parado.`,
    );
  const tanks = withTag("TANK");
  if (tanks.length >= 2)
    warnings.push(
      `${tanks.length} inimigos aguentam muita porrada. Dano proporcional à vida resolve melhor que dano puro.`,
    );

  const threats = list
    .map((champion) => ({ champion, ...dangerOf(champion, me) }))
    .sort((a, b) => b.danger - a.danger);

  return {
    champions: list,
    physicalShare,
    damageVerdict,
    healingSources: uniqueHealing,
    shieldSources: withTag("SHIELD"),
    hardCcSources: cc,
    tanks,
    threats,
    warnings,
  };
}

/** Frase curta descrevendo o campeão em português, para o cabeçalho do card. */
export function describeChampion(champion: ChampionRef): string {
  return champion.tags
    .slice(0, 3)
    .map((t) => tagLabel(t.slug))
    .join(" · ");
}
