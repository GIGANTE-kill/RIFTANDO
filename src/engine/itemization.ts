/**
 * Motor de itemização. Determinístico: mesmo estado → mesma recomendação.
 *
 *   estado da partida → contexto de métricas → regras que disparam → itens
 *
 * Roda no cliente (é TS puro), então a recomendação atualiza a cada clique
 * sem ida ao servidor.
 */
import { evaluateCondition, type RuleCondition } from "./rules-dsl";
import {
  statAtLevel,
  sumItemStats,
  EMPTY_ITEM_STATS,
  type ChampionRef,
  type ItemRef,
  type ItemStats,
  type MatchState,
  type CombatantState,
  type DamageType,
} from "./types";

export type CounterRuleRef = {
  id: number;
  slug: string;
  title: string;
  priority: number;
  condition: RuleCondition;
  recommendTagSlugs: string[];
  recommendItemIds: number[];
  excludeItemIds: number[];
  explanation: string;
};

export type Catalog = {
  items: Map<number, ItemRef>;
  champions: Map<string, ChampionRef>;
  rules: CounterRuleRef[];
};

/** Tudo que as regras podem consultar. Chaves com ponto viram caminho no DSL. */
export type MatchContext = {
  threat: CombatantStats & { tags: string[] };
  self: CombatantStats & {
    tags: string[];
    ownedItemTags: string[];
    primaryDamageType: DamageType;
    gold: number;
  };
  enemyTeam: {
    healingSources: number;
    shieldSources: number;
    hardCcCount: number;
    adThreatCount: number;
    apThreatCount: number;
  };
};

type CombatantStats = {
  totalHealth: number;
  armor: number;
  magicResist: number;
  attackDamage: number;
  abilityPower: number;
  attackSpeed: number;
  criticalChance: number;
  lifesteal: number;
  omnivamp: number;
  effectiveHpVsPhysical: number;
  effectiveHpVsMagic: number;
};

const tagSlugs = (champion?: ChampionRef) => champion?.tags.map((t) => t.slug) ?? [];

/** Vida efetiva: o que realmente importa para decidir entre penetração e dano. */
const effectiveHp = (health: number, resistance: number) =>
  health * (1 + Math.max(0, resistance) / 100);

function combatantStats(
  state: CombatantState,
  catalog: Catalog,
): CombatantStats & { champion?: ChampionRef; items: ItemRef[] } {
  const champion = state.championId ? catalog.champions.get(state.championId) : undefined;
  const items = state.itemIds
    .map((id) => catalog.items.get(id))
    .filter((i): i is ItemRef => Boolean(i));
  const fromItems: ItemStats = items.length ? sumItemStats(items) : { ...EMPTY_ITEM_STATS };

  const base = champion?.base;
  const health =
    (base ? statAtLevel(base.hp, base.hpPerLevel, state.level) : 0) + fromItems.health;
  const armor =
    (base ? statAtLevel(base.armor, base.armorPerLevel, state.level) : 0) + fromItems.armor;
  const magicResist =
    (base ? statAtLevel(base.magicResist, base.mrPerLevel, state.level) : 0) + fromItems.magicResist;
  const attackDamage =
    (base ? statAtLevel(base.attackDamage, base.adPerLevel, state.level) : 0) +
    fromItems.attackDamage;

  return {
    champion,
    items,
    totalHealth: Math.round(health),
    armor: Math.round(armor),
    magicResist: Math.round(magicResist),
    attackDamage: Math.round(attackDamage),
    abilityPower: fromItems.abilityPower,
    attackSpeed: fromItems.attackSpeed,
    criticalChance: fromItems.criticalChance,
    lifesteal: fromItems.lifesteal,
    omnivamp: fromItems.omnivamp,
    effectiveHpVsPhysical: Math.round(effectiveHp(health, armor)),
    effectiveHpVsMagic: Math.round(effectiveHp(health, magicResist)),
  };
}

/**
 * Físico ou mágico?
 *
 * A classificação da própria Riot manda. Antes isto era inferido das tags, e a
 * Ashe saía como "dano misto" porque a ultimate dela causa dano mágico — o que
 * fazia o motor recomendar Morellonomicon para uma atiradora. A inferência
 * continua como reserva, para campeão sem ficha.
 */
function primaryDamageType(champion: ChampionRef | undefined, items: ItemRef[]): DamageType {
  if (champion?.officialDamageType) return champion.officialDamageType;

  const weight = (slug: string) => champion?.tags.find((t) => t.slug === slug)?.weight ?? 0;
  const fromItems = sumItemStats(items);
  const ad = weight("AD_DAMAGE") + (fromItems.attackDamage > 0 ? 40 : 0);
  const ap = weight("AP_DAMAGE") + (fromItems.abilityPower > 0 ? 40 : 0);
  if (ad === 0 && ap === 0) return "PHYSICAL";
  const ratio = Math.min(ad, ap) / Math.max(ad, ap);
  if (ratio > 0.75) return "MIXED";
  return ad >= ap ? "PHYSICAL" : "MAGIC";
}

export function buildContext(state: MatchState, catalog: Catalog): MatchContext {
  const self = combatantStats(state.self, catalog);
  const threat = combatantStats(state.threat, catalog);

  const enemyCombatants = [
    state.threat,
    ...state.enemyTeam,
  ];

  const enemyStats = enemyCombatants
    .filter((c) => Boolean(c.championId))
    .map((c) => combatantStats(c, catalog))
    .filter((s) => Boolean(s.champion));

  const hasTag = (s: ReturnType<typeof combatantStats>, slugs: string[]) =>
    s.champion!.tags.some((t) => slugs.includes(t.slug) && t.weight >= 50);

  const countWithTag = (...slugs: string[]) =>
    enemyStats.filter((s) => hasTag(s, slugs)).length;

  return {
    threat: { ...threat, tags: tagSlugs(threat.champion) },
    self: {
      ...self,
      tags: tagSlugs(self.champion),
      ownedItemTags: [...new Set(self.items.flatMap((i) => i.tags))],
      primaryDamageType: primaryDamageType(self.champion, self.items),
      gold: state.self.gold ?? 0,
    },
    enemyTeam: {
      healingSources: enemyStats.filter((s) =>
        hasTag(s, ["SELF_HEAL", "TEAM_HEAL", "LIFESTEAL_SCALING"]) ||
        s.items.some((i) => i.stats.lifesteal > 0 || i.stats.omnivamp > 0 || i.stats.healAndShieldPower > 0)
      ).length,
      shieldSources: enemyStats.filter((s) =>
        hasTag(s, ["SHIELD"]) ||
        s.items.some((i) => i.stats.healAndShieldPower > 0)
      ).length,
      hardCcCount: countWithTag("HARD_CC"),
      adThreatCount: countWithTag("AD_DAMAGE"),
      apThreatCount: countWithTag("AP_DAMAGE"),
    },
  };
}

/**
 * Tags cujo valor é quantitativo: entre dois itens de RM, o que dá 80 resolve
 * mais que o que dá 25. Sem isso o desempate cai no mais barato e o motor
 * sugere Zeke's Convergence no lugar de Spirit Visage.
 *
 * As outras tags (ANTI_HEAL, PERCENT_HP_DMG) são binárias: ou o efeito existe
 * ou não, e a quantidade não muda a decisão.
 */
const TAG_STAT: Partial<Record<string, keyof ItemStats>> = {
  ARMOR_ITEM: "armor",
  MR_ITEM: "magicResist",
  HP_ITEM: "health",
  ARMOR_PEN: "armorPen",
  MAGIC_PEN: "magicPen",
  TENACITY: "tenacity",
};

/** Maior valor de cada stat no catálogo, para normalizar em 0..1. */
function statCeilings(catalog: Catalog): Partial<Record<keyof ItemStats, number>> {
  const ceilings: Partial<Record<keyof ItemStats, number>> = {};
  for (const stat of Object.values(TAG_STAT)) {
    let max = 0;
    for (const item of catalog.items.values()) max = Math.max(max, item.stats[stat!] ?? 0);
    ceilings[stat!] = max || 1;
  }
  return ceilings;
}

/** 0.5 (efeito presente mas fraco) a 1.0 (o melhor do catálogo). */
function magnitude(
  item: ItemRef,
  tagSlugs: string[],
  ceilings: Partial<Record<keyof ItemStats, number>>,
): number {
  const relevant = tagSlugs.map((t) => TAG_STAT[t]).filter(Boolean) as (keyof ItemStats)[];
  if (!relevant.length) return 1;
  const best = Math.max(
    ...relevant.map((stat) => (item.stats[stat] ?? 0) / (ceilings[stat] ?? 1)),
  );
  return 0.5 + 0.5 * Math.min(1, best);
}

/**
 * Categorias que nunca são "o próximo item da build": poção, sentinela,
 * bugiganga, item de selva e item de renda de suporte. Todas estavam no
 * catálogo e todas podiam ser recomendadas — Poção de Vida tem vida, e a regra
 * de vida a aceitava.
 */
const NEVER_RECOMMEND = ["Consumable", "Trinket", "Jungle", "GoldPer", "Vision"];

/** Abaixo disso é item inicial (Doran, Espada Longa), não resposta ao inimigo. */
const MIN_GOLD = 700;

/**
 * Itens de suporte não se declaram como tal: o Berrante do Guardião não tem
 * categoria nenhuma que o denuncie. Mas todos descendem do Atlas Mundial, que
 * tem `GoldPer`. Então subimos a árvore de construção até achar a origem.
 */
function buildsFromSupportItem(item: ItemRef, catalog: Catalog, depth = 0): boolean {
  if (depth > 3) return false;
  return item.buildsFrom.some((id) => {
    const parent = catalog.items.get(id);
    if (!parent) return false;
    if (parent.categories.includes("GoldPer")) return true;
    return buildsFromSupportItem(parent, catalog, depth + 1);
  });
}

/** O item pode sequer ser sugerido a este campeão? */
function isRecommendable(item: ItemRef, catalog: Catalog, myChampionId: string | null): boolean {
  if (item.categories.some((c) => NEVER_RECOMMEND.includes(c))) return false;
  if (item.totalGold < MIN_GOLD) return false;
  // Lança Negra da Kalista e afins: só para o dono
  if (item.requiredChampion && item.requiredChampion !== myChampionId) return false;
  return true;
}

/**
 * Itens cujo valor só aparece batendo com auto-ataque.
 *
 * A categoria `OnHit` da Riot cobre 21 itens, mas deixa de fora justamente os
 * casos que enganam: o Coração de Aço é `[Health, HealthRegen]` para a Riot, e
 * todo o efeito dele é "seu próximo Ataque contra o alvo causa...". Sem isto,
 * ele era oferecido a um mago como se fosse item de vida qualquer.
 *
 * O texto sozinho não basta: Armadura de Espinhos diz "When struck by an
 * Attack" — isso é apanhar, não atacar. Daí a lista de exclusão vir primeiro.
 */
const DEFENSIVE_ATTACK_TEXT =
  /(struck|hit) by an attack|incoming damage from attacks|reduce the attack speed|damage from attacks/i;

const ATTACK_PAYOFF_TEXT =
  /your (next|first) attack|attacks deal|attacks grant|attacks apply|on-hit|on-attack|basic attacks?|every (second|third) attack|attacking generates|energized attack/i;

function dependsOnAttacks(item: ItemRef): boolean {
  if (item.categories.includes("OnHit")) return true;
  const text = item.passiveText ?? "";
  if (DEFENSIVE_ATTACK_TEXT.test(text)) return false;
  return ATTACK_PAYOFF_TEXT.test(text);
}

/** O campeão realmente bate de auto-ataque a ponto de aproveitar esses itens? */
function reliesOnAttacks(champion: ChampionRef | undefined): boolean {
  if (!champion) return true; // sem informação, não penaliza
  const dps = champion.tags.find((t) => t.slug === "SUSTAINED_DPS")?.weight ?? 0;
  if (dps >= 50) return true;
  if (champion.classes.includes("Marksman")) return true;
  // lutadores e tanques corpo a corpo vivem de auto-ataque entre habilidades —
  // é para eles que o Coração de Aço existe
  const bruiserOrTank =
    champion.classes.includes("Fighter") || champion.classes.includes("Tank");
  return bruiserOrTank && champion.attackType === "MELEE";
}

const isOffensiveAD = (i: ItemRef) =>
  i.stats.attackDamage > 0 || i.stats.criticalChance > 0 || i.stats.attackSpeed > 0 || i.stats.lifesteal > 0;
const isOffensiveAP = (i: ItemRef) => i.stats.abilityPower > 0;
const isSupportItem = (i: ItemRef, catalog: Catalog) =>
  i.stats.healAndShieldPower > 0 ||
  i.categories.includes("Aura") ||
  i.categories.includes("GoldPer") ||
  buildsFromSupportItem(i, catalog);

/**
 * Afinidade item↔campeão, 0..1. Sem isso o motor sugere Thornmail para a Lux
 * (o item tem corta-cura, mas ela nunca vai comprá-lo) e Locket para o Darius.
 *
 * É multiplicador, não filtro: um item levemente fora do perfil ainda aparece
 * se resolver um problema urgente o bastante.
 */
export function itemFit(
  item: ItemRef,
  champion: ChampionRef | undefined,
  damage: DamageType,
  catalog: Catalog,
  role: MatchState["selfRole"],
): number {
  let fit = 1;

  const ad = isOffensiveAD(item);
  const ap = isOffensiveAP(item);

  // ─── Tanque / Suporte não escala com item ofensivo puro ──────────
  //
  // Blitzcrank faz dano mágico, mas não vai comprar Morellonomicon —
  // ele quer Armadura de Espinhos para o corta-cura. A Riot classifica
  // o tipo de *dano das habilidades*, não o tipo de *item que o boneco
  // constrói*. Tanques e suportes corpo a corpo constroem utilidade e
  // defesa; itens ofensivos puros são desperdício de ouro.
  const isTankOrSupport =
    champion?.classes.includes("Tank") || champion?.classes.includes("Support");
  const isMeleeUtility = isTankOrSupport && champion?.attackType === "MELEE";

  if (isMeleeUtility) {
    // Item puramente ofensivo AP (Morellonomicon, Ludens, etc) em tank/suporte:
    // quase nunca é certo. A exceção seria um item de suporte com AP (ex:
    // Ardent Censer), mas esses já são tratados por `isSupportItem`.
    if (ap && !ad) {
      const supportUtility = isSupportItem(item, catalog);
      fit *= supportUtility ? 0.6 : 0.12;
    }
    // Item puramente ofensivo AD (Youmuu, Collector, etc) em tank/suporte:
    // igualmente fora de perfil.
    if (ad && !ap) {
      const hasDefensiveStat = item.stats.health > 0 || item.stats.armor > 0 || item.stats.magicResist > 0;
      fit *= hasDefensiveStat ? 0.5 : 0.12;
    }
  } else {
    // ─── Campeões que de fato escalam com dano ────────────────────
    let mixedAd = 0.7;
    let mixedAp = 0.7;

    if (damage === "MIXED" && champion) {
      const adW = champion.tags.find((t) => t.slug === "AD_DAMAGE")?.weight ?? 0;
      const apW = champion.tags.find((t) => t.slug === "AP_DAMAGE")?.weight ?? 0;
      if (adW > apW + 10) {
        mixedAd = 0.9;
        mixedAp = 0.3;
      } else if (apW > adW + 10) {
        mixedAd = 0.3;
        mixedAp = 0.9;
      }
    }

    if (ad && !ap) fit *= damage === "PHYSICAL" ? 1 : damage === "MIXED" ? mixedAd : 0.15;
    if (ap && !ad) fit *= damage === "MAGIC" ? 1 : damage === "MIXED" ? mixedAp : 0.15;
  }

  // item que só rende batendo, em quem não bate: quase inútil
  if (dependsOnAttacks(item) && !reliesOnAttacks(champion)) fit *= 0.3;

  // Crítico só compensa acumulado com velocidade de ataque e mais crítico. Um
  // tanque comprando 25% de chance de crítico está jogando ouro fora — era por
  // isso que o Sion recebia Lembrete Mortal.
  const critItem = item.stats.criticalChance > 0;
  const critChampion =
    champion?.classes.includes("Marksman") ||
    (champion?.tags.find((t) => t.slug === "SUSTAINED_DPS")?.weight ?? 0) >= 60;
  if (critItem && champion?.classes.includes("Tank") && !critChampion) fit *= 0.35;

  const support = isSupportItem(item, catalog);
  // a rota manda quando é conhecida; a classe é só o palpite de reserva
  const playingSupport =
    role === "SUPPORT" ||
    (role === undefined &&
      (champion?.classes.includes("Support") ||
        champion?.tags.some((t) => ["TEAM_HEAL", "SHIELD"].includes(t.slug) && t.weight >= 60)));
  if (support && !playingSupport) fit *= 0.2;

  // item puramente defensivo: essencial para quem segura porrada, secundário
  // para quem precisa converter ouro em dano
  if (!ad && !ap && !support) {
    const bulky = champion?.tags.some(
      (t) => ["TANK", "BRUISER"].includes(t.slug) && t.weight >= 60,
    );
    fit *= bulky || !champion ? 1 : 0.45;
  }

  return fit;
}

export type Recommendation = {
  item: ItemRef;
  score: number;
  reasons: { slug: string; title: string; explanation: string }[];
  /** quando o lendário não cabe no ouro atual, o passo intermediário que cabe */
  buyNow: ItemRef | null;
  affordable: boolean;
};

/* ─── Direção de Build ─────────────────────────────────────────────── */

export type BuildPath = "AP" | "AD" | "DEFENSE" | "UTILITY";

export type BuildPathRecommendation = {
  recommended: BuildPath;
  paths: { path: BuildPath; score: number; label: string; reasons: string[] }[];
};

const BUILD_PATH_LABEL: Record<BuildPath, string> = {
  AP: "Dano Mágico (AP)",
  AD: "Dano Físico (AD)",
  DEFENSE: "Defesa (Tanque)",
  UTILITY: "Utilidade (Suporte)",
};

/**
 * Avalia qual direção de build faz mais sentido para este campeão
 * neste contexto de partida.
 */
export function recommendBuildPath(
  champion: ChampionRef | undefined,
  context: MatchContext,
  role: MatchState["selfRole"],
  allyChampions: ChampionRef[],
): BuildPathRecommendation {
  const scores: Record<BuildPath, { score: number; reasons: string[] }> = {
    AP: { score: 0, reasons: [] },
    AD: { score: 0, reasons: [] },
    DEFENSE: { score: 0, reasons: [] },
    UTILITY: { score: 0, reasons: [] },
  };

  if (!champion) {
    return {
      recommended: "AD",
      paths: Object.entries(scores).map(([path, { score, reasons }]) => ({
        path: path as BuildPath,
        score,
        label: BUILD_PATH_LABEL[path as BuildPath],
        reasons,
      })),
    };
  }

  const tagW = (slug: string) => champion.tags.find((t) => t.slug === slug)?.weight ?? 0;
  const isTank = champion.classes.includes("Tank");
  const isSupport = champion.classes.includes("Support");
  const isMage = champion.classes.includes("Mage");
  const isMarksman = champion.classes.includes("Marksman");
  const isFighter = champion.classes.includes("Fighter");
  const isAssassin = champion.classes.includes("Assassin");
  const isMelee = champion.attackType === "MELEE";

  const adAptitude = tagW("AD_DAMAGE");
  const apAptitude = tagW("AP_DAMAGE");
  const tankAptitude = tagW("TANK");

  // AP
  scores.AP.score += apAptitude * 0.5;
  if (isMage) { scores.AP.score += 25; scores.AP.reasons.push("Classe Mago — escala com AP"); }
  if (champion.officialDamageType === "MAGIC" && !isTank && !isSupport) {
    scores.AP.score += 15;
    scores.AP.reasons.push("Dano das habilidades é mágico");
  }

  // AD
  scores.AD.score += adAptitude * 0.5;
  if (isMarksman) { scores.AD.score += 30; scores.AD.reasons.push("Classe Atirador — escala com AD"); }
  if (isAssassin && champion.officialDamageType === "PHYSICAL") {
    scores.AD.score += 25;
    scores.AD.reasons.push("Assassino físico");
  }
  if (isFighter && champion.officialDamageType !== "MAGIC") {
    scores.AD.score += 15;
    scores.AD.reasons.push("Lutador — aproveita dano de ataque");
  }

  // DEFENSE
  scores.DEFENSE.score += tankAptitude * 0.5;
  if (isTank) { scores.DEFENSE.score += 25; scores.DEFENSE.reasons.push("Classe Tanque"); }
  if (isMelee && !isAssassin) {
    scores.DEFENSE.score += 8;
    scores.DEFENSE.reasons.push("Corpo a corpo — precisa sobreviver");
  }
  if (champion.playstyle?.durability && champion.playstyle.durability >= 2) {
    scores.DEFENSE.score += 10;
    scores.DEFENSE.reasons.push("Alta durabilidade natural");
  }

  // UTILITY
  if (isSupport) { scores.UTILITY.score += 30; scores.UTILITY.reasons.push("Classe Suporte"); }
  if (role === "SUPPORT") {
    scores.UTILITY.score += 15;
    scores.UTILITY.reasons.push("Jogando de suporte");
  }
  if (tagW("TEAM_HEAL") >= 50 || tagW("SHIELD") >= 50) {
    scores.UTILITY.score += 12;
    scores.UTILITY.reasons.push("Possui cura ou escudo para o time");
  }

  // ─── Contexto da partida ──────────────────────────────────────

  const teamApCount = allyChampions.filter(
    (c) => c.officialDamageType === "MAGIC" || (c.tags.find((t) => t.slug === "AP_DAMAGE")?.weight ?? 0) >= 70,
  ).length;
  const teamAdCount = allyChampions.filter(
    (c) => c.officialDamageType === "PHYSICAL" || (c.tags.find((t) => t.slug === "AD_DAMAGE")?.weight ?? 0) >= 70,
  ).length;

  if (teamApCount === 0 && apAptitude >= 40) {
    scores.AP.score += 12;
    scores.AP.reasons.push("Time sem dano mágico");
  }
  if (teamAdCount === 0 && adAptitude >= 40) {
    scores.AD.score += 12;
    scores.AD.reasons.push("Time sem dano físico");
  }

  if (context.threat.armor >= 150 && apAptitude >= 40) {
    scores.AP.score += 10;
    scores.AP.reasons.push("Inimigo com muita armadura");
  }
  if (context.threat.magicResist >= 100 && adAptitude >= 40) {
    scores.AD.score += 10;
    scores.AD.reasons.push("Inimigo com muita RM");
  }

  const teamHasTank = allyChampions.some(
    (c) => c.classes.includes("Tank") || (c.tags.find((t) => t.slug === "TANK")?.weight ?? 0) >= 60,
  );
  if (!teamHasTank && (isTank || isFighter)) {
    scores.DEFENSE.score += 12;
    scores.DEFENSE.reasons.push("Time sem frontline");
  }

  if (role !== "SUPPORT" && !isSupport) {
    scores.UTILITY.score -= 20;
  }

  // ─── Penalizações para builds irreais ─────────────────────────

  if (isTank && isSupport && isMelee && apAptitude < 60) {
    scores.AP.score *= 0.3;
  }
  if (isMage && !isTank && champion.attackType === "RANGED") {
    scores.DEFENSE.score *= 0.5;
  }

  const sorted = (Object.entries(scores) as [BuildPath, { score: number; reasons: string[] }][])
    .map(([path, { score, reasons }]) => ({
      path,
      score: Math.round(score * 10) / 10,
      label: BUILD_PATH_LABEL[path],
      reasons: reasons.slice(0, 3),
    }))
    .sort((a, b) => b.score - a.score);

  return { recommended: sorted[0].path, paths: sorted };
}

export type Analysis = {
  context: MatchContext;
  firedRules: CounterRuleRef[];
  recommendations: Recommendation[];
  buildPath: BuildPathRecommendation;
};

/**
 * Componente mais barato do item que já carrega a mesma tag e cabe no ouro.
 * Ex.: sem 3000g para Mortal Reminder, compre Executioner's Calling por 800g —
 * o corta-cura já começa a valer agora.
 */
function affordableStep(item: ItemRef, gold: number, catalog: Catalog, wantedTags: string[]) {
  if (gold <= 0 || item.totalGold <= gold) return null;

  const candidates = item.buildsFrom
    .map((id) => catalog.items.get(id))
    .filter((c): c is ItemRef => Boolean(c))
    .filter((c) => c.totalGold <= gold);
  if (!candidates.length) return null;

  // prioriza o componente que já entrega o efeito que a regra pediu
  const carrying = candidates.filter((c) => c.tags.some((t) => wantedTags.includes(t)));
  const pool = carrying.length ? carrying : candidates;
  return pool.sort((a, b) => b.totalGold - a.totalGold)[0];
}

export function analyze(
  state: MatchState,
  catalog: Catalog,
  limit = 2,
  /** IDs dos aliados para análise de direção de build */
  allyChampionIds: string[] = [],
): Analysis {
  const context = buildContext(state, catalog);

  const firedRules = catalog.rules
    .filter((rule) => evaluateCondition(rule.condition, context as unknown as Record<string, unknown>))
    .sort((a, b) => b.priority - a.priority);

  const owned = new Set(state.self.itemIds);
  const excluded = new Set(firedRules.flatMap((r) => r.excludeItemIds));
  const selfChampion = state.self.championId
    ? catalog.champions.get(state.self.championId)
    : undefined;
  const ceilings = statCeilings(catalog);

  // um item pode atender várias regras: soma as prioridades e guarda o porquê
  const scored = new Map<number, { score: number; reasons: Recommendation["reasons"]; tags: string[] }>();

  for (const rule of firedRules) {
    const matches = [...catalog.items.values()].filter((item) => {
      if (owned.has(item.id) || excluded.has(item.id)) return false;
      if (!isRecommendable(item, catalog, state.self.championId)) return false;
      if (rule.recommendItemIds.includes(item.id)) return true;
      return item.tags.some((t) => rule.recommendTagSlugs.includes(t));
    });

    for (const item of matches) {
      const fit = itemFit(
        item,
        selfChampion,
        context.self.primaryDamageType,
        catalog,
        state.selfRole,
      );
      if (fit < 0.2) continue; // fora do perfil a ponto de nunca ser comprado

      const entry = scored.get(item.id) ?? { score: 0, reasons: [], tags: [] };
      // itens finais valem mais que componentes; explícito vale mais que por tag
      const specificity = rule.recommendItemIds.includes(item.id) ? 1.5 : 1;
      const finality = item.isLegendary ? 1 : 0.55;
      const weight = magnitude(item, rule.recommendTagSlugs, ceilings);
      entry.score += rule.priority * specificity * finality * fit * weight;
      entry.reasons.push({ slug: rule.slug, title: rule.title, explanation: rule.explanation });
      entry.tags.push(...rule.recommendTagSlugs);
      scored.set(item.id, entry);
    }
  }

  const gold = context.self.gold;
  const ranked = [...scored.entries()]
    .map(([id, entry]) => {
      const item = catalog.items.get(id)!;
      return {
        item,
        score: Math.round(entry.score),
        reasons: entry.reasons,
        affordable: gold > 0 && item.totalGold <= gold,
        buyNow: affordableStep(item, gold, catalog, entry.tags),
      };
    })
    // desempate por ouro: entre dois itens que resolvem o mesmo problema,
    // o mais barato entra em jogo antes
    .sort((a, b) => b.score - a.score || a.item.totalGold - b.item.totalGold);

  // Sugerir Morellonomicon E Oblivion Orb é uma recomendação só ocupando duas
  // vagas — o componente já aparece como "comprar agora". Fica o de maior score.
  // Uma sugestão muito abaixo da primeira não é uma opção, é ruído — era o que
  // colocava Cota Espinhosa na lista de um mago.
  const topScore = ranked[0]?.score ?? 0;
  const relevant = ranked.filter((r) => r.score >= topScore * 0.6);

  const recommendations: Recommendation[] = [];
  for (const candidate of relevant) {
    if (recommendations.length >= limit) break;
    const sharesPath = recommendations.some(
      (chosen) =>
        chosen.item.buildsFrom.includes(candidate.item.id) ||
        candidate.item.buildsFrom.includes(chosen.item.id),
    );
    if (!sharesPath) recommendations.push(candidate);
  }

  // ─── Direção de Build ──────────────────────────────────────────
  const allyChampions = allyChampionIds
    .map((id) => catalog.champions.get(id))
    .filter((c): c is ChampionRef => Boolean(c));
  const buildPath = recommendBuildPath(selfChampion, context, state.selfRole, allyChampions);

  return { context, firedRules, recommendations, buildPath };
}
