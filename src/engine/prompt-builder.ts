/**
 * Gerador do "Diagnóstico Tático": transforma o estado da partida e a saída dos
 * motores num texto estruturado. O jogador cola numa IA externa se quiser — a
 * ferramenta não chama nenhuma API.
 */
import type { Analysis, Catalog } from "./itemization";
import type { MatchupAnalysis } from "./matchup";
import { verdictLabel } from "./matchup";
import type { Phase, Role, TeamAnalysis } from "./match";
import { PHASE_LABEL, ROLE_LABEL } from "./match";
import type { PlanStep } from "./game-plan";
import { tagLabel } from "./tag-catalog";
import type { MatchState } from "./types";

/** Diagnóstico completo: rota, composição, itens e plano do momento. */
export function buildMatchDiagnosis({
  patch,
  minute,
  phase,
  role,
  matchup,
  enemyTeam,
  itemization,
  plan,
  catalog,
  state,
}: {
  patch: string;
  minute: number;
  phase: Phase;
  role: Role;
  matchup: MatchupAnalysis;
  enemyTeam: TeamAnalysis;
  itemization: Analysis;
  plan: PlanStep[];
  catalog: Catalog;
  state: MatchState;
}): string {
  const itemNames = (ids: number[]) =>
    ids.map((id) => catalog.items.get(id)?.name ?? `#${id}`).join(", ") || "nenhum";

  const { context } = itemization;

  return [
    `# Minha partida — League of Legends (patch ${patch})`,
    "",
    `Minuto ${minute} · ${PHASE_LABEL[phase]}`,
    "",
    `## Eu`,
    `- Rota: ${ROLE_LABEL[role]}`,
    `- Campeão: ${matchup.self?.name ?? "—"} (nível ${state.self.level})`,
    `- Itens: ${itemNames(state.self.itemIds)}`,
    `- Ouro disponível: ${context.self.gold || "não informado"}`,
    `- Meu dano é principalmente: ${context.self.primaryDamageType === "PHYSICAL" ? "de ataque" : context.self.primaryDamageType === "MAGIC" ? "mágico" : "misto"}`,
    "",
    `## Confronto direto`,
    `- Inimigo: ${matchup.enemy?.name ?? "—"}`,
    `- Situação da rota: ${verdictLabel(matchup.verdict)} (${matchup.score > 0 ? "+" : ""}${matchup.score} numa escala de -10 a +10)`,
    `- Risco de sofrer gank: ${matchup.gankRisk.level} — ${matchup.gankRisk.reason}`,
    ...(matchup.contributions.length
      ? [
          "- Por quê:",
          ...matchup.contributions
            .slice(0, 5)
            .map(
              (c) =>
                `  · ${c.label} (${c.advantage > 0 ? "+" : ""}${Math.round(c.advantage * 10) / 10})`,
            ),
        ]
      : []),
    "",
    `## Time inimigo`,
    `- Campeões: ${enemyTeam.champions.map((c) => c.name).join(", ") || "não informados"}`,
    `- Origem do dano: ${enemyTeam.physicalShare}% de ataque, ${100 - enemyTeam.physicalShare}% mágico`,
    `- ${enemyTeam.damageVerdict}`,
    ...(enemyTeam.warnings.length ? enemyTeam.warnings.map((w) => `- Atenção: ${w}`) : []),
    ...(enemyTeam.threats.length
      ? [
          "- Quem mais te ameaça:",
          ...enemyTeam.threats
            .slice(0, 3)
            .map((t) => `  · ${t.champion.name} — ${t.why}`),
        ]
      : []),
    "",
    `## Alvo analisado para itens`,
    `- Campeão: ${state.threat.championId ?? "—"} (nível ${state.threat.level})`,
    `- Itens dele: ${itemNames(state.threat.itemIds)}`,
    `- Vida ${context.threat.totalHealth} · Armadura ${context.threat.armor} · Resistência mágica ${context.threat.magicResist}`,
    `- Para derrubá-lo você precisa causar, na prática: ${context.threat.effectiveHpVsPhysical} de dano de ataque ou ${context.threat.effectiveHpVsMagic} de dano mágico`,
    "",
    `## Itens recomendados agora`,
    ...(itemization.recommendations.length
      ? itemization.recommendations.flatMap((rec, i) => [
          `${i + 1}. ${rec.item.name} (${rec.item.totalGold} de ouro)${rec.buyNow ? ` — dá para comprar agora: ${rec.buyNow.name} (${rec.buyNow.totalGold})` : ""}`,
          ...rec.reasons.map((r) => `   · ${r.explanation}`),
        ])
      : ["- Nenhum contra-item urgente: siga sua build padrão."]),
    "",
    `## Plano para os próximos minutos`,
    ...plan.map((step, i) => `${i + 1}. ${step.title} — ${step.detail}`),
    "",
    `## Pergunta`,
    `Esse plano faz sentido para o minuto ${minute}? O que você mudaria?`,
  ].join("\n");
}

/** Versão curta, só do confronto de rota. */
export function buildMatchupDiagnosis(analysis: MatchupAnalysis, patch: string): string {
  const { self, enemy, score, verdict, contributions, gankRisk, plan, isOverride } = analysis;

  return [
    `# Diagnóstico de Rota — League of Legends (patch ${patch})`,
    "",
    `- Eu: ${self?.name ?? "—"}${self ? ` (alcance ${self.attackRange})` : ""}`,
    `- Inimigo: ${enemy?.name ?? "—"}${enemy ? ` (alcance ${enemy.attackRange})` : ""}`,
    `- Situação: ${verdictLabel(verdict)} (${score > 0 ? "+" : ""}${score} de -10 a +10)${isOverride ? " — confronto revisado à mão" : ""}`,
    `- Risco de gank: ${gankRisk.level} — ${gankRisk.reason}`,
    "",
    `## De onde vem a vantagem`,
    ...(contributions.length
      ? contributions
          .slice(0, 6)
          .map(
            (c) => `- ${c.label}: ${c.advantage > 0 ? "+" : ""}${Math.round(c.advantage * 10) / 10}`,
          )
      : ["- Nenhuma regra cobriu esse par."]),
    "",
    `## Plano em 3 passos`,
    ...plan.map((step, i) => `${i + 1}. ${step.title} — ${step.detail}`),
  ].join("\n");
}

/** Perfil do campeão em palavras, usado nos cards. */
export function championSummary(tags: { slug: string }[]): string {
  return tags
    .slice(0, 4)
    .map((t) => tagLabel(t.slug))
    .join(" · ");
}
