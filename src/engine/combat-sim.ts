/**
 * Simulador de combate ao vivo.
 *
 * Calcula a vantagem relativa entre dois combatentes com base nos stats
 * efetivos (vida, resistência, dano, sustain). Não é uma previsão exata
 * do 1v1 (isso depende de cooldowns e mecânica), mas dá o retrato de
 * "quem está mais forte agora" e como cada item muda esse retrato.
 *
 * Roda no cliente, sem servidor — recalcula a cada clique.
 */
import type { CombatantState, ChampionRef, ItemRef, DamageType } from "./types";
import { buildContext, type Catalog, type MatchContext } from "./itemization";
import type { MatchState } from "./types";

export type CombatSnapshot = {
  /** seu poder de combate estimado (0 = morto, 100 = pico de força) */
  selfPower: number;
  /** poder de combate do inimigo */
  enemyPower: number;
  /** chance de vencer a troca (0..100) */
  winChance: number;
  /** postura recomendada */
  posture: "AGRESSIVO" | "NEUTRO" | "RECUADO" | "PERIGOSO";
  postureLabel: string;
  postureDetail: string;
  /** deltas: o que mudou em relação ao snapshot anterior */
  deltas: StatDelta[];
};

export type StatDelta = {
  label: string;
  before: number;
  after: number;
  delta: number;
  /** positivo = bom pra você */
  favorable: boolean;
};

/**
 * Estima o DPS efetivo de um combatente contra as resistências do oponente.
 *
 * Fórmula simplificada:
 *   DPS_físico = AD × (1 + AS/100) × (1 + crit/100 × 0.75) × multiplicador_de_armadura
 *   DPS_mágico = AP × 0.6 × multiplicador_de_RM
 *   total = max(DPS_físico, DPS_mágico) + (sustain via lifesteal/omnivamp)
 */
function estimateDps(
  attacker: MatchContext["self"] | MatchContext["threat"],
  defender: MatchContext["self"] | MatchContext["threat"],
  damageType: DamageType,
): number {
  const armorMult = 100 / (100 + Math.max(0, defender.armor));
  const mrMult = 100 / (100 + Math.max(0, defender.magicResist));

  const physicalDps =
    attacker.attackDamage *
    (1 + attacker.attackSpeed / 100) *
    (1 + (attacker.criticalChance / 100) * 0.75) *
    armorMult;

  const magicDps = attacker.abilityPower * 0.6 * mrMult;

  let baseDps: number;
  if (damageType === "PHYSICAL") baseDps = physicalDps;
  else if (damageType === "MAGIC") baseDps = magicDps;
  else baseDps = physicalDps * 0.6 + magicDps * 0.6;

  // sustain estende a luta a favor do atacante
  const sustain = (attacker.lifesteal + attacker.omnivamp) / 100;
  const sustainBonus = baseDps * sustain * 0.4; // lifesteal não cura 100% do DPS

  return Math.max(1, baseDps + sustainBonus);
}

/** Quanto tempo (em "ticks" normalizados) para matar o defensor */
function timeToKill(
  dps: number,
  defenderHp: number,
): number {
  if (dps <= 0) return 999;
  return defenderHp / dps;
}

/**
 * Calcula o combate agrupado (ex: 2v2, 3v3).
 * Soma o DPS efetivo de todos os aliados contra a EHP combinada dos inimigos.
 */
export function simulateTeamCombat(
  allies: MatchState["allyTeam"],
  enemies: MatchState["enemyTeam"],
  catalog: Catalog
): CombatSnapshot {
  if (!allies || allies.length === 0 || !enemies || enemies.length === 0) {
    return {
      selfPower: 50,
      enemyPower: 50,
      winChance: 50,
      posture: "NEUTRO",
      postureLabel: "Selecione combatentes",
      postureDetail: "Marque pelo menos um aliado e um inimigo nas caixas de seleção para simular a luta.",
      deltas: []
    };
  }

  let totalAllyDps = 0;
  let totalAllyHp = 0;
  
  for (const ally of allies) {
    const c = catalog.champions.get(ally.championId ?? "");
    if (!c) continue;
    // mock a state to use buildContext
    const mockState: MatchState = { self: ally, threat: ally, enemyTeam: [] };
    const ctx = buildContext(mockState, catalog);
    // Para simplificar no modo grupo, vamos usar a EHP média (como se o dano inimigo fosse misto)
    const dps = estimateDps(ctx.self, ctx.self, ctx.self.primaryDamageType);
    totalAllyDps += dps;
    totalAllyHp += ctx.self.totalHealth + (ctx.self.armor + ctx.self.magicResist) * 5; // pseudo EHP
  }

  let totalEnemyDps = 0;
  let totalEnemyHp = 0;

  for (const enemy of enemies) {
    const c = catalog.champions.get(enemy.championId ?? "");
    if (!c) continue;
    const mockState: MatchState = { self: enemy, threat: enemy, enemyTeam: [] };
    const ctx = buildContext(mockState, catalog);
    const damageType = c.officialDamageType ?? "PHYSICAL";
    const dps = estimateDps(ctx.self, ctx.self, damageType);
    totalEnemyDps += dps;
    totalEnemyHp += ctx.self.totalHealth + (ctx.self.armor + ctx.self.magicResist) * 5;
  }

  const myTtk = timeToKill(totalAllyDps, totalEnemyHp);
  const hisTtk = timeToKill(totalEnemyDps, totalAllyHp);

  const totalTtk = myTtk + hisTtk || 1;
  const selfPower = Math.round((hisTtk / totalTtk) * 100);
  const enemyPower = Math.round((myTtk / totalTtk) * 100);

  const rawRatio = hisTtk / (myTtk || 0.01);
  const winChance = Math.max(5, Math.min(95, Math.round(50 * rawRatio)));

  let posture: CombatSnapshot["posture"] = "NEUTRO";
  let postureLabel = "Luta Equilibrada";
  let postureDetail = "Esta luta em grupo é definida por quem iniciar melhor e focar o alvo certo.";

  if (winChance >= 65) {
    posture = "AGRESSIVO";
    postureLabel = "Vantagem Numérica/Itens";
    postureDetail = "Seu time tem clara vantagem matemática. Podem forçar a luta se não houver surpresas no mapa.";
  } else if (winChance <= 35) {
    posture = "PERIGOSO";
    postureLabel = "Não Lute";
    postureDetail = "Desvantagem severa. Evitem o confronto direto e busquem farm ou vantagens numéricas isoladas.";
  } else if (winChance <= 45) {
    posture = "RECUADO";
    postureLabel = "Joguem com Cautela";
    postureDetail = "Leve desvantagem. Só aceitem a luta se o inimigo errar uma habilidade chave ou mergulhar sob a torre.";
  }

  return {
    selfPower,
    enemyPower,
    winChance,
    posture,
    postureLabel,
    postureDetail,
    deltas: []
  };
}

/**
 * Analisa o estado de combate ao vivo entre você e a ameaça.
 */
export function simulateCombat(
  state: MatchState,
  catalog: Catalog,
  matchupScore: number = 0,
  gankRiskLevel: "BAIXO" | "MÉDIO" | "ALTO" = "MÉDIO",
): CombatSnapshot {
  const context = buildContext(state, catalog);
  const selfChampion = state.self.championId
    ? catalog.champions.get(state.self.championId)
    : undefined;
  const threatChampion = state.threat.championId
    ? catalog.champions.get(state.threat.championId)
    : undefined;

  const selfDamageType = context.self.primaryDamageType;
  const threatDamageType = threatChampion?.officialDamageType ?? "PHYSICAL";

  // DPS de cada lado contra as resistências do outro
  const myDps = estimateDps(context.self, context.threat, selfDamageType);
  const hisDps = estimateDps(context.threat, context.self, threatDamageType);

  // Tempo para matar (menos = mais forte)
  const myTtk = timeToKill(myDps, context.threat.totalHealth);
  const hisTtk = timeToKill(hisDps, context.self.totalHealth);

  // Poder relativo: puramente baseado em atributos (items + level)
  const totalTtk = myTtk + hisTtk || 1;
  const selfPower = Math.round((hisTtk / totalTtk) * 100);
  const enemyPower = Math.round((myTtk / totalTtk) * 100);

  // Chance de vencer: baseada na razão de TTK MAS corrigida pela nota da rota
  const rawRatio = hisTtk / (myTtk || 0.01);
  let rawWinChance = 50 * rawRatio;
  
  // Funde a matemática crua (itens/atributos) com a tática da rota (matchup)
  // Cada 1 ponto de vantagem na rota (ex: +2.0) aumenta a chance em 15%
  const tacticalShift = matchupScore * 15;
  let winChance = Math.max(5, Math.min(95, Math.round(rawWinChance + tacticalShift)));

  // Postura tática
  let posture: CombatSnapshot["posture"];
  let postureLabel: string;
  let postureDetail: string;

  const isBotLane = state.selfRole === "ADC" || state.selfRole === "SUPPORT";
  const enemyIsSupport = threatChampion?.classes.includes("Support");
  
  if (winChance >= 65) {
    posture = "AGRESSIVO";
    postureLabel = "Jogue agressivo";
    
    if (isBotLane && enemyIsSupport) {
      postureDetail = `Vocês dominam a trocação. Apenas certifique-se de iniciar no alvo correto (geralmente o atirador) em vez de focar todo o dano em ${threatChampion?.name || "o suporte"}.`;
    } else {
      postureDetail = selfChampion && threatChampion
        ? `${selfChampion.name} ganha a troca contra ${threatChampion.name} com os itens atuais. Force trocas e pressione.`
        : "Você tem grande vantagem de combate. Puna o inimigo por farmar.";
    }
  } else if (winChance >= 45) {
    posture = "NEUTRO";
    postureLabel = "Troca equilibrada";
    
    if (isBotLane) {
      postureDetail = "A rota 2v2 está parelha. Quem iniciar errado ou gastar a principal habilidade no ar perde a troca.";
    } else {
      postureDetail = "Nenhum dos dois domina. Troque quando suas habilidades estiverem disponíveis e as dele não.";
    }
  } else if (winChance >= 30) {
    posture = "RECUADO";
    postureLabel = "Jogue recuado";
    
    if (state.selfRole === "SUPPORT") {
      postureDetail = "Desvantagem na troca direta. Ignore o suporte inimigo, proteja seu atirador e farme debaixo da torre.";
    } else if (state.selfRole === "ADC") {
      postureDetail = "Você perde a trocação. Foque 100% em garantir farm e deixe seu suporte ditar o ritmo de qualquer agressão.";
    } else {
      postureDetail = selfChampion && threatChampion
        ? `${threatChampion.name} ganha a troca agora. Farme seguro e espere seu próximo item para equilibrar.`
        : "Inimigo com vantagem de combate. Evite trocar dano desnecessário.";
    }
  } else {
    posture = "PERIGOSO";
    postureLabel = "Evite o confronto";
    
    if (isBotLane) {
      postureDetail = "Se vocês tentarem lutar no 2v2 agora, a chance de serem esmagados é alta. Sacrifique farm se necessário para não morrer.";
    } else {
      postureDetail = selfChampion && threatChampion
        ? `${threatChampion.name} te destrói no 1v1. Não passe do meio da rota sozinho.`
        : "Desvantagem severa. Não lute sozinho sob nenhuma hipótese.";
    }
  }

  // Alerta de Gank
  if (gankRiskLevel === "ALTO" && posture !== "PERIGOSO") {
    postureDetail += " ATENÇÃO: O risco de gank do inimigo é ALTO. Só aplique essa postura agressiva se tiver certeza de onde o caçador inimigo está.";
  }

  return {
    selfPower,
    enemyPower,
    winChance,
    posture,
    postureLabel,
    postureDetail,
    deltas: [],
  };
}

/**
 * Compara dois snapshots e gera os deltas de stats.
 */
export function computeDeltas(
  before: MatchContext,
  after: MatchContext,
): StatDelta[] {
  const deltas: StatDelta[] = [];

  const stats: { key: keyof typeof before.self; label: string; higherIsBetter: boolean }[] = [
    { key: "totalHealth", label: "Vida", higherIsBetter: true },
    { key: "armor", label: "Armadura", higherIsBetter: true },
    { key: "magicResist", label: "RM", higherIsBetter: true },
    { key: "attackDamage", label: "Dano de Ataque", higherIsBetter: true },
    { key: "abilityPower", label: "Poder de Habilidade", higherIsBetter: true },
    { key: "effectiveHpVsPhysical", label: "EHP vs Físico", higherIsBetter: true },
    { key: "effectiveHpVsMagic", label: "EHP vs Mágico", higherIsBetter: true },
  ];

  for (const { key, label, higherIsBetter } of stats) {
    const bVal = before.self[key] as number;
    const aVal = after.self[key] as number;
    const delta = aVal - bVal;
    if (Math.abs(delta) >= 1) {
      deltas.push({
        label,
        before: Math.round(bVal),
        after: Math.round(aVal),
        delta: Math.round(delta),
        favorable: higherIsBetter ? delta > 0 : delta < 0,
      });
    }
  }

  // deltas do inimigo (quando ELE compra item)
  const enemyStats: { key: keyof typeof before.threat; label: string; higherIsBetter: boolean }[] = [
    { key: "totalHealth", label: "Vida dele", higherIsBetter: false },
    { key: "armor", label: "Armadura dele", higherIsBetter: false },
    { key: "magicResist", label: "RM dele", higherIsBetter: false },
    { key: "attackDamage", label: "Dano dele", higherIsBetter: false },
    { key: "lifesteal", label: "Roubo de Vida dele", higherIsBetter: false },
  ];

  for (const { key, label, higherIsBetter } of enemyStats) {
    const bVal = before.threat[key] as number;
    const aVal = after.threat[key] as number;
    const delta = aVal - bVal;
    if (Math.abs(delta) >= 1) {
      deltas.push({
        label,
        before: Math.round(bVal),
        after: Math.round(aVal),
        delta: Math.round(delta),
        favorable: higherIsBetter ? delta > 0 : delta < 0,
      });
    }
  }

  return deltas;
}
