/** Tipos compartilhados pelo motor. TypeScript puro: sem React, sem DB. */

export type DamageType = "PHYSICAL" | "MAGIC" | "MIXED";

export type ItemStats = {
  health: number;
  armor: number;
  magicResist: number;
  attackDamage: number;
  abilityPower: number;
  attackSpeed: number;
  criticalChance: number;
  lifesteal: number;
  omnivamp: number;
  abilityHaste: number;
  moveSpeed: number;
  tenacity: number;
  armorPen: number;
  magicPen: number;
  healAndShieldPower: number;
};

export type ItemRef = {
  id: number;
  name: string;
  iconUrl: string | null;
  totalGold: number;
  isLegendary: boolean;
  buildsFrom: number[];
  buildsInto: number[];
  /** categorias oficiais da Riot: Consumable, Trinket, Jungle, GoldPer... */
  categories: string[];
  /** item exclusivo de um campeão (Lança Negra da Kalista) */
  requiredChampion: string | null;
  /** texto das passivas em inglês — é dele que sai a leitura de efeito */
  passiveText: string | null;
  tags: string[];
  stats: ItemStats;
};

export type ChampionRef = {
  id: string;
  /** id numérico da Riot — é como o cliente do LoL e a API se referem ao campeão */
  riotId: number;
  name: string;
  iconUrl: string | null;
  attackType: "MELEE" | "RANGED";
  attackRange: number;
  classes: string[];
  /** rotas em que o campeão é jogado */
  positions: ("TOP" | "JUNGLE" | "MID" | "ADC" | "SUPPORT")[];
  /** 1 fácil, 2 médio, 3 difícil — segundo a Riot */
  difficulty: number | null;
  officialDamageType: "PHYSICAL" | "MAGIC" | "MIXED" | null;
  /** eixos oficiais da Riot, de 1 a 3 */
  playstyle: {
    damage: number;
    durability: number;
    crowdControl: number;
    mobility: number;
    utility: number;
  } | null;
  tags: { slug: string; weight: number }[];
  /** stats base no nível 1 + crescimento por nível */
  base: {
    hp: number;
    hpPerLevel: number;
    armor: number;
    armorPerLevel: number;
    magicResist: number;
    mrPerLevel: number;
    attackDamage: number;
    adPerLevel: number;
  };
};

/** Um campeão em jogo: quem é, em que nível, com quais itens. */
export type CombatantState = {
  championId: string | null;
  level: number;
  itemIds: number[];
};

export type LaneRole = "TOP" | "JUNGLE" | "MID" | "ADC" | "SUPPORT";

export type MatchState = {
  /**
   * A rota em que VOCÊ está. Sem isso o motor usa a classe do campeão, e a Lux
   * — que é Mage/Support para a Riot — recebia itens de suporte mesmo jogando
   * no meio.
   */
  selfRole?: LaneRole;
  self: CombatantState & { gold?: number };
  /** o inimigo direto ou a maior ameaça do time — o alvo da análise */
  threat: CombatantState;
  /** os outros campeões do time inimigo com seus níveis e itens, para métricas de composição */
  enemyTeam: CombatantState[];
  /** os outros campeões do seu time com seus itens */
  allyTeam?: CombatantState[];
};

export const EMPTY_ITEM_STATS: ItemStats = {
  health: 0, armor: 0, magicResist: 0, attackDamage: 0, abilityPower: 0,
  attackSpeed: 0, criticalChance: 0, lifesteal: 0, omnivamp: 0, abilityHaste: 0,
  moveSpeed: 0, tenacity: 0, armorPen: 0, magicPen: 0, healAndShieldPower: 0,
};

/**
 * Fórmula oficial de crescimento por nível da Riot. Não é linear: o ganho
 * acelera com o nível. Usar `base + growth * (n-1)` erra ~14% no nível 18,
 * o que jogaria as regras de limiar (3000 de vida, 120 de armadura) fora.
 */
export function statAtLevel(base: number, growth: number, level: number): number {
  const n = Math.max(1, Math.min(18, level));
  return base + growth * (n - 1) * (0.7025 + 0.0175 * (n - 1));
}

export function sumItemStats(items: ItemRef[]): ItemStats {
  const total = { ...EMPTY_ITEM_STATS };
  for (const item of items) {
    for (const key of Object.keys(total) as (keyof ItemStats)[]) {
      total[key] += item.stats[key] ?? 0;
    }
  }
  return total;
}
