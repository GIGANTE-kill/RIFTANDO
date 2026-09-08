/**
 * Catálogo canônico de tags. Fonte da verdade do vocabulário tático.
 *
 * `label` é o que aparece na tela: português direto, sem sigla e sem jargão.
 * O `slug` continua em inglês porque é chave de banco e de regra.
 */
export const TAG_CATALOG = [
  // RANGE
  { slug: "MELEE_SHORT", category: "RANGE", label: "Corpo a corpo", description: "Precisa encostar para causar dano" },
  { slug: "MELEE_EXTENDED", category: "RANGE", label: "Corpo a corpo de alcance maior", description: "Bate um pouco mais longe que o normal" },
  { slug: "RANGED_SHORT", category: "RANGE", label: "Ataque à distância curta", description: null },
  { slug: "RANGED_LONG", category: "RANGE", label: "Ataque à distância longa", description: "Bate de longe sem se expor" },

  // DAMAGE_PROFILE
  { slug: "BURST", category: "DAMAGE_PROFILE", label: "Mata rápido", description: "Te derruba numa sequência curta de habilidades" },
  { slug: "SUSTAINED_DPS", category: "DAMAGE_PROFILE", label: "Dano contínuo", description: "Depende de bater várias vezes ao longo da luta" },
  { slug: "DOT", category: "DAMAGE_PROFILE", label: "Dano ao longo do tempo", description: "Veneno, queimadura e afins" },
  { slug: "TRUE_DAMAGE", category: "DAMAGE_PROFILE", label: "Dano verdadeiro", description: "Ignora qualquer defesa" },
  { slug: "AD_DAMAGE", category: "DAMAGE_PROFILE", label: "Dano de ataque", description: "Defesa contra isso é armadura" },
  { slug: "AP_DAMAGE", category: "DAMAGE_PROFILE", label: "Dano mágico", description: "Defesa contra isso é resistência mágica" },
  { slug: "MIXED_DAMAGE", category: "DAMAGE_PROFILE", label: "Dano misto", description: "Ataque e magia ao mesmo tempo" },

  // CROWD_CONTROL
  { slug: "HARD_CC", category: "CROWD_CONTROL", label: "Prende de verdade", description: "Atordoa, enraíza, joga pro alto ou suprime" },
  { slug: "SOFT_CC", category: "CROWD_CONTROL", label: "Atrapalha", description: "Lentidão, cegueira, silêncio" },
  { slug: "DISPLACEMENT", category: "CROWD_CONTROL", label: "Empurra ou puxa", description: null },

  // MOBILITY
  { slug: "DASH", category: "MOBILITY", label: "Tem avanço", description: "Consegue fechar distância num impulso" },
  { slug: "BLINK", category: "MOBILITY", label: "Teleporta", description: null },
  { slug: "SPEED_BOOST", category: "MOBILITY", label: "Fica mais rápido", description: null },
  { slug: "IMMOBILE", category: "MOBILITY", label: "Sem fuga", description: "Não tem avanço nem teleporte para escapar" },

  // SUSTAIN
  { slug: "SELF_HEAL", category: "SUSTAIN", label: "Se cura", description: null },
  { slug: "TEAM_HEAL", category: "SUSTAIN", label: "Cura os aliados", description: null },
  { slug: "SHIELD", category: "SUSTAIN", label: "Dá escudo", description: null },
  { slug: "LIFESTEAL_SCALING", category: "SUSTAIN", label: "Vive de roubo de vida", description: null },

  // PATTERN
  { slug: "ALL_IN", category: "PATTERN", label: "Vai pra cima", description: "Aposta tudo numa investida só" },
  { slug: "POKE", category: "PATTERN", label: "Cutuca de longe", description: "Tira vida aos poucos sem se arriscar" },
  { slug: "ENGAGE", category: "PATTERN", label: "Inicia a luta", description: "Começa o confronto prendendo alguém" },
  { slug: "DISENGAGE", category: "PATTERN", label: "Corta a luta", description: "Consegue interromper a investida do inimigo" },
  { slug: "SPLIT_PUSH", category: "PATTERN", label: "Pressiona sozinho", description: null },
  { slug: "SCALING", category: "PATTERN", label: "Fica forte com o tempo", description: "Precisa de itens ou acúmulo para brilhar" },
  { slug: "EARLY_GAME", category: "PATTERN", label: "Forte no começo", description: "A força dele tem prazo de validade" },

  // DEFENSE
  { slug: "TANK", category: "DEFENSE", label: "Aguenta porrada", description: null },
  { slug: "BRUISER", category: "DEFENSE", label: "Aguenta e bate", description: null },
  { slug: "SQUISHY", category: "DEFENSE", label: "Frágil", description: "Morre rápido se for pego" },

  // ITEM_EFFECT
  { slug: "ANTI_HEAL", category: "ITEM_EFFECT", label: "Corta a cura do inimigo", description: "Aplica Feridas Graves" },
  { slug: "PERCENT_HP_DMG", category: "ITEM_EFFECT", label: "Dano proporcional à vida", description: "Quanto mais vida o alvo tem, mais dói" },
  { slug: "ARMOR_PEN", category: "ITEM_EFFECT", label: "Fura armadura", description: "Ignora parte da defesa física do alvo" },
  { slug: "MAGIC_PEN", category: "ITEM_EFFECT", label: "Fura resistência mágica", description: "Ignora parte da defesa mágica do alvo" },
  { slug: "ANTI_CRIT", category: "ITEM_EFFECT", label: "Reduz dano crítico", description: null },
  { slug: "ANTI_AS", category: "ITEM_EFFECT", label: "Reduz velocidade de ataque", description: null },
  { slug: "ANTI_AUTO_ATTACK", category: "ITEM_EFFECT", label: "Reduz dano de ataques normais", description: "Botas Blindadas, Cota Espinhosa" },
  { slug: "ANTI_SHIELD", category: "ITEM_EFFECT", label: "Quebra escudos", description: null },
  { slug: "ANTI_BURST", category: "ITEM_EFFECT", label: "Salva de sequências rápidas", description: "Escudo ou imunidade que dispara sozinho" },
  { slug: "ARMOR_ITEM", category: "ITEM_EFFECT", label: "Armadura", description: "Defesa contra dano de ataque" },
  { slug: "MR_ITEM", category: "ITEM_EFFECT", label: "Resistência mágica", description: "Defesa contra dano mágico" },
  { slug: "HP_ITEM", category: "ITEM_EFFECT", label: "Vida", description: null },
  { slug: "TENACITY", category: "ITEM_EFFECT", label: "Tenacidade", description: "Encurta o tempo preso por atordoamento e lentidão" },
] as const;

export type TagSlug = (typeof TAG_CATALOG)[number]["slug"];

const BY_SLUG = new Map(TAG_CATALOG.map((t) => [t.slug as string, t]));

/** Nome legível de uma tag. Nunca mostre o slug na tela. */
export function tagLabel(slug: string): string {
  return BY_SLUG.get(slug)?.label ?? slug;
}

export function tagDescription(slug: string): string | null {
  return BY_SLUG.get(slug)?.description ?? null;
}
