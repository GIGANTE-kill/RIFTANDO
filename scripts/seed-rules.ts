/**
 * Seed das regras táticas — o "cérebro" da ferramenta, versionado no repo.
 *   npm run db:seed
 *
 * Idempotente por slug: editar uma regra aqui e rodar de novo atualiza a linha.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { notInArray, sql } from "drizzle-orm";
import { db } from "../src/db";
import { counterRules, matchupTagRules, championMatchupOverrides } from "../src/db/schema";
import type { RuleCondition } from "../src/engine/rules-dsl";

type CounterSeed = {
  slug: string;
  title: string;
  priority: number;
  condition: RuleCondition;
  recommendTagSlugs: string[];
  explanation: string;
  phase?: "EARLY" | "MID" | "LATE" | "ANY";
};

/**
 * Métricas disponíveis no contexto (montadas por src/engine/itemization.ts):
 *   threat.totalHealth | threat.armor | threat.magicResist | threat.attackSpeed
 *   threat.lifesteal | threat.omnivamp | threat.criticalChance | threat.tags[]
 *   self.primaryDamageType | self.tags[] | self.ownedItemTags[]
 *   enemyTeam.healingSources | enemyTeam.adThreatCount | enemyTeam.apThreatCount
 */
const COUNTER_RULES: CounterSeed[] = [
  {
    slug: "high-hp-needs-percent-hp",
    title: "Alvo com muita vida",
    priority: 90,
    condition: {
      all: [
        { metric: "threat.totalHealth", op: ">=", value: 3000 },
        { metric: "self.ownedItemTags", op: "excludes", value: "PERCENT_HP_DMG" },
      ],
    },
    recommendTagSlugs: ["PERCENT_HP_DMG"],
    explanation:
      "A ameaça passou de 3000 de vida: dano fixo perde eficiência. Um item de dano por % de vida máxima converte o HP dele em desvantagem.",
  },
  {
    slug: "enemy-healing-needs-antiheal",
    title: "Inimigo com cura relevante",
    priority: 95,
    condition: {
      any: [
        { metric: "threat.lifesteal", op: ">=", value: 12 },
        { metric: "threat.omnivamp", op: ">=", value: 8 },
        { metric: "enemyTeam.healingSources", op: ">=", value: 2 },
      ],
    },
    recommendTagSlugs: ["ANTI_HEAL"],
    explanation:
      "Há sustain suficiente do outro lado para anular seu dano em lutas longas. Corta-cura aplica Feridas Graves e reduz esse retorno pela metade.",
  },
  {
    slug: "stacked-armor-needs-pen",
    title: "Alvo empilhando armadura",
    priority: 85,
    condition: {
      all: [
        { metric: "threat.armor", op: ">=", value: 120 },
        { metric: "self.primaryDamageType", op: "eq", value: "PHYSICAL" },
      ],
    },
    recommendTagSlugs: ["ARMOR_PEN"],
    explanation:
      "Acima de ~120 de armadura, cada AD extra vale pouco. Penetração devolve mais dano efetivo por ouro do que mais dano bruto.",
  },
  {
    slug: "stacked-mr-needs-magic-pen",
    title: "Alvo empilhando resistência mágica",
    priority: 85,
    condition: {
      all: [
        { metric: "threat.magicResist", op: ">=", value: 80 },
        { metric: "self.primaryDamageType", op: "eq", value: "MAGIC" },
      ],
    },
    recommendTagSlugs: ["MAGIC_PEN"],
    explanation: "MR alta do outro lado: penetração mágica supera mais poder de habilidade.",
  },
  {
    slug: "enemy-crit-carry-needs-armor",
    title: "Carregador crítico do outro lado",
    priority: 80,
    condition: {
      any: [
        { metric: "threat.criticalChance", op: ">=", value: 40 },
        { metric: "threat.attackSpeed", op: ">=", value: 60 },
      ],
    },
    recommendTagSlugs: ["ANTI_CRIT", "ARMOR_ITEM", "ANTI_AS"],
    explanation:
      "A ameaça é DPS de auto-ataque. Armadura + redução de crítico/velocidade de ataque corta o dano dela mais barato do que vida pura.",
  },
  {
    slug: "burst-mage-needs-mr-hp",
    title: "Burst mágico do outro lado",
    priority: 78,
    condition: {
      all: [
        { metric: "threat.tags", op: "includes", value: "BURST" },
        { metric: "threat.tags", op: "includes", value: "AP_DAMAGE" },
      ],
    },
    recommendTagSlugs: ["MR_ITEM", "ANTI_BURST", "HP_ITEM"],
    explanation:
      "Você morre numa rotação. RM + vida elevam seu limiar de sobrevivência acima do combo dele, e um efeito reativo compra o tempo da resposta.",
  },
  {
    slug: "heavy-cc-needs-tenacity",
    title: "Composição com muito CC",
    priority: 70,
    condition: { metric: "enemyTeam.hardCcCount", op: ">=", value: 3 },
    recommendTagSlugs: ["TENACITY"],
    explanation:
      "Com 3+ fontes de CC pesado, o problema não é o dano — é o tempo parado. Tenacidade converte esse tempo em dano seu.",
    phase: "MID",
  },
  {
    slug: "enemy-shields-need-shield-break",
    title: "Escudos recorrentes",
    priority: 60,
    condition: { metric: "enemyTeam.shieldSources", op: ">=", value: 2 },
    recommendTagSlugs: ["ANTI_SHIELD"],
    explanation: "Escudos repetidos anulam seu burst; quebra-escudo devolve a janela de kill.",
  },
];

/**
 * advantage: -5 (muito desfavorável) a +5 (muito favorável).
 *
 * Pares de alcance (RANGED_* × MELEE_*) NÃO entram aqui: o motor calcula a
 * diferença numérica de alcance direto, e ter os dois somava o mesmo fato duas
 * vezes — era o que fazia Lux x Zed sair como "muito favorável" para a Lux.
 */
const MATCHUP_RULES = [
  { selfTagSlug: "POKE", enemyTagSlug: "ALL_IN", advantage: 2, guideline: "Mantenha a wave no meio da rota e a barra de vida dele abaixo de 60%. Nunca fique sem escape disponível." },
  { selfTagSlug: "POKE", enemyTagSlug: "ENGAGE", advantage: -2, guideline: "Poke não vale a vida: fique atrás da wave, use visão lateral e só troque quando o engage dele estiver em recarga." },
  { selfTagSlug: "ALL_IN", enemyTagSlug: "POKE", advantage: -1, guideline: "Congele a wave perto da sua torre, farme com habilidades e espere o nível 6 ou a rotação da selva." },
  { selfTagSlug: "ENGAGE", enemyTagSlug: "IMMOBILE", advantage: 3, guideline: "Ele não tem escape: force a luta com o CC assim que a wave estiver a seu favor e peça a selva." },
  { selfTagSlug: "IMMOBILE", enemyTagSlug: "DASH", advantage: -2, guideline: "Você não escapa de um gap-close: posicione-se sempre atrás da onda e guarde o feitiço de sumoner para o dash dele." },
  { selfTagSlug: "EARLY_GAME", enemyTagSlug: "SCALING", advantage: 3, guideline: "Sua vantagem tem prazo de validade: force pressão antes dos 14 minutos e transforme em torre ou objetivo." },
  { selfTagSlug: "SCALING", enemyTagSlug: "EARLY_GAME", advantage: -3, guideline: "Farme seguro, aceite perder CS sob torre e evite trocas até o segundo item; sua curva vira o jogo depois." },
  { selfTagSlug: "SUSTAINED_DPS", enemyTagSlug: "BURST", advantage: -1, guideline: "Ele vence a troca curta. Force lutas prolongadas com aliados e evite ficar sozinho em corredor sem visão." },
  { selfTagSlug: "SELF_HEAL", enemyTagSlug: "POKE", advantage: 2, guideline: "Sua cura anula o chip damage: absorva o poke, mantenha o CS e force a all-in quando o recurso dele acabar." },

  // --- defesa × perfil de dano ---
  { selfTagSlug: "TANK", enemyTagSlug: "SUSTAINED_DPS", advantage: 2, guideline: "Ele precisa de tempo para acumular dano e você tem resistência para negar esse tempo. Force a troca curta e saia antes do quarto auto-ataque." },
  { selfTagSlug: "TANK", enemyTagSlug: "BURST", advantage: -1, guideline: "Sua vida não impede o combo dele. Compre resistência do tipo certo cedo e evite ficar sozinho sem visão até o segundo item." },
  { selfTagSlug: "SQUISHY", enemyTagSlug: "ALL_IN", advantage: -2, guideline: "Uma all-in dele te mata. Fique atrás da wave, guarde o feitiço de sumoner e só avance com a habilidade de engage dele em recarga." },
  { selfTagSlug: "SQUISHY", enemyTagSlug: "BURST", advantage: -2, guideline: "Vocês dois morrem rápido, mas ele escolhe a hora. Jogue por trás da onda e force que ele use a rotação no minion." },
  { selfTagSlug: "TRUE_DAMAGE", enemyTagSlug: "TANK", advantage: 2, guideline: "Resistência não te segura. Force trocas prolongadas e trate a barra de vida dele como se fosse a metade." },
  { selfTagSlug: "BRUISER", enemyTagSlug: "SQUISHY", advantage: 2, guideline: "Você aguenta a troca que ele não aguenta. Force contato sempre que a wave estiver equilibrada." },

  // --- controle de grupo × mobilidade ---
  { selfTagSlug: "HARD_CC", enemyTagSlug: "IMMOBILE", advantage: 2, guideline: "Seu CC é sentença para quem não tem saída. Coordene com a selva: um acerto já vale o kill." },
  { selfTagSlug: "IMMOBILE", enemyTagSlug: "HARD_CC", advantage: -3, guideline: "Um acerto dele encerra a troca. Posicione-se sempre atrás dos minions e trate cada habilidade de CC dele como o gatilho para recuar." },
  { selfTagSlug: "DASH", enemyTagSlug: "IMMOBILE", advantage: 2, guideline: "Você escolhe quando a luta acontece. Espere ele gastar a habilidade de zoneamento e entre." },
  { selfTagSlug: "DISENGAGE", enemyTagSlug: "ENGAGE", advantage: 2, guideline: "Guarde o desengajo para o momento em que ele se comprometer — é a troca inteira decidida num botão." },

  // --- sustentação × dano ---
  { selfTagSlug: "SELF_HEAL", enemyTagSlug: "SUSTAINED_DPS", advantage: 1, guideline: "Sua cura vence a troca longa se você não levar o combo inteiro. Escalone as trocas em vez de aceitar uma só." },
  { selfTagSlug: "POKE", enemyTagSlug: "SELF_HEAL", advantage: -2, guideline: "Ele cura o seu poke de volta. Não gaste recurso à toa: espere o corta-cura ou a rotação da selva." },
  { selfTagSlug: "SHIELD", enemyTagSlug: "POKE", advantage: 1, guideline: "O escudo anula o chip damage dele. Absorva a habilidade e avance na janela de recarga." },

  // --- tempo de jogo ---
  { selfTagSlug: "EARLY_GAME", enemyTagSlug: "IMMOBILE", advantage: 2, guideline: "Sua força é agora e ele não escapa. Force a primeira all-in no nível 2, antes do segundo ponto de habilidade dele." },
  { selfTagSlug: "SCALING", enemyTagSlug: "ALL_IN", advantage: -2, guideline: "Ele vence toda troca antes dos itens. Farme sob torre, use a habilidade de wave clear e espere sua curva." },
] as const;

/**
 * Confrontos curados: entram quando a mecânica que decide a rota não existe
 * como tag. O override substitui o placar inteiro do motor.
 *
 * Cada linha aqui é uma admissão honesta de que o derivador não chegou lá —
 * e o custo de acertar é uma linha, não um algoritmo novo.
 */
const CHAMPION_OVERRIDES = [
  {
    selfChampionId: "Teemo",
    enemyChampionId: "Darius",
    advantage: 4,
    guideline:
      "A cegueira anula os auto-ataques dele, que é de onde vem quase todo o dano e a cura da passiva. Mantenha distância, cegue no momento em que ele avançar e nunca fique preso na área do E.",
  },
  {
    selfChampionId: "Darius",
    enemyChampionId: "Teemo",
    advantage: -4,
    guideline:
      "Você não alcança e ele cega seus autos. Farme com o Q à distância, peça rotação da selva cedo e jogue por outro lado do mapa se a rota travar.",
  },
  {
    selfChampionId: "Malphite",
    enemyChampionId: "Yasuo",
    advantage: 3,
    guideline:
      "Sua armadura base e o Q anulam a troca de auto-ataques dele, e o vento não bloqueia dano corpo a corpo. Empurre a wave e negue o CS até o nível 6.",
  },
];

async function main() {
  for (const rule of COUNTER_RULES) {
    await db
      .insert(counterRules)
      .values({ ...rule, recommendItemIds: [], excludeItemIds: [], phase: rule.phase ?? "ANY" })
      .onConflictDoUpdate({
        target: counterRules.slug,
        set: {
          title: rule.title,
          priority: rule.priority,
          condition: rule.condition,
          recommendTagSlugs: rule.recommendTagSlugs,
          explanation: rule.explanation,
          phase: rule.phase ?? "ANY",
        },
      });
  }
  console.log(`✔ ${COUNTER_RULES.length} regras de contra-item`);

  for (const m of MATCHUP_RULES) {
    await db
      .insert(matchupTagRules)
      .values({ ...m, phase: "EARLY" })
      .onConflictDoUpdate({
        target: [matchupTagRules.selfTagSlug, matchupTagRules.enemyTagSlug, matchupTagRules.phase],
        set: { advantage: m.advantage, guideline: m.guideline },
      });
  }
  console.log(`✔ ${MATCHUP_RULES.length} regras de matchup`);

  for (const o of CHAMPION_OVERRIDES) {
    await db
      .insert(championMatchupOverrides)
      .values(o)
      .onConflictDoUpdate({
        target: [
          championMatchupOverrides.selfChampionId,
          championMatchupOverrides.enemyChampionId,
        ],
        set: { advantage: o.advantage, guideline: o.guideline },
      });
  }
  console.log(`✔ ${CHAMPION_OVERRIDES.length} confrontos curados`);

  // regras removidas deste arquivo somem do banco: o seed é a fonte da verdade
  const staleCounters = await db
    .delete(counterRules)
    .where(notInArray(counterRules.slug, COUNTER_RULES.map((r) => r.slug)))
    .returning({ slug: counterRules.slug });

  const seededPairs = MATCHUP_RULES.map((m) => `${m.selfTagSlug}|${m.enemyTagSlug}`);
  const staleMatchups = await db
    .delete(matchupTagRules)
    .where(
      notInArray(
        sql`${matchupTagRules.selfTagSlug} || '|' || ${matchupTagRules.enemyTagSlug}`,
        seededPairs,
      ),
    )
    .returning({ id: matchupTagRules.id });

  if (staleCounters.length || staleMatchups.length) {
    console.log(
      `· removidas ${staleCounters.length} regra(s) de item e ${staleMatchups.length} de matchup que saíram do seed`,
    );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
