/**
 * Derivador heurístico de tags — puro, testável, sem DB.
 *
 * Sinal principal: a marcação semântica dos tooltips da Riot
 * (<physicalDamage>, <healing>, <shield>, <status>Stunned</status>) e as
 * `categories` oficiais dos itens. Vocabulário fechado, mantido pela própria
 * Riot — não quebra quando a redação do texto muda.
 *
 * Regra de ouro: o derivador NUNCA sobrescreve uma tag marcada como `manual`.
 * Ele cobre campeões novos sozinho; suas correções ficam permanentes.
 */
import type { AbilitySnapshot } from "@/db/schema/champions";
import type { TagSlug } from "./tag-catalog";

export type DerivedTag = { slug: TagSlug; weight: number };

export type ChampionDerivationInput = {
  attackRange: number;
  hp: number;
  armor: number;
  magicResist: number;
  classes: string[]; // Fighter, Mage, Marksman, Assassin, Tank, Support
  abilities: AbilitySnapshot[];
};

export type ItemDerivationInput = {
  categories: string[];
  passiveText: string | null;
  health: number;
  armor: number;
  magicResist: number;
  attackSpeed: number;
  criticalChance: number;
  lifesteal: number;
  omnivamp: number;
  armorPen: number;
  magicPen: number;
  tenacity: number;
};

/**
 * A Riot flexiona os <status>: "Stuns", "Stunning", "Stunned" são a mesma coisa,
 * e existem ~70 variantes no jogo. Casamos por radical, não por forma exata.
 */
const HARD_CC_STEMS = [
  "stun", "root", "snare", "knock", "airborne", "charm", "fear", "flee", "taunt",
  "suppress", "asleep", "sleep", "drowsy", "stasis", "banish", "polymorph",
  "immobiliz", "disabl", "berserk",
];
const SOFT_CC_STEMS = ["slow", "silenc", "ground", "blind", "disarm", "nearsight", "cripple"];
const DISPLACEMENT_STEMS = ["knock", "pull", "drag", "push", "airborne"];

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function deriveChampionTags(input: ChampionDerivationInput): DerivedTag[] {
  const out: DerivedTag[] = [];
  const push = (slug: TagSlug, weight: number) => {
    if (weight > 0) out.push({ slug, weight: clamp(weight) });
  };

  const abilities = input.abilities;
  const allStatuses = abilities.flatMap((a) => a.statuses.map((s) => s.toLowerCase()));
  const allMarkers = new Set(abilities.flatMap((a) => a.markers));
  const allText = abilities.map((a) => a.text.toLowerCase()).join(" ");
  const classes = input.classes.map((c) => c.toLowerCase());

  const countStatus = (stems: string[]) =>
    abilities.filter((a) =>
      a.statuses.some((s) => stems.some((stem) => s.toLowerCase().includes(stem))),
    ).length;
  const countText = (...needles: string[]) =>
    abilities.filter((a) => needles.some((n) => a.text.toLowerCase().includes(n))).length;

  // --- RANGE: puramente numérico, 100% confiável ---
  const r = input.attackRange;
  if (r <= 150) push("MELEE_SHORT", 100);
  else if (r < 300) push("MELEE_EXTENDED", 100);
  else if (r < 550) push("RANGED_SHORT", 100);
  else push("RANGED_LONG", 100);

  // --- CROWD CONTROL: via <status> ---
  const hardCc = countStatus(HARD_CC_STEMS);
  const softCc = countStatus(SOFT_CC_STEMS);
  const displacement = countStatus(DISPLACEMENT_STEMS);
  if (hardCc) push("HARD_CC", 40 + hardCc * 22);
  if (softCc) push("SOFT_CC", 35 + softCc * 18);
  if (displacement) push("DISPLACEMENT", 45 + displacement * 20);

  // --- MOBILITY ---
  // nem toda mobilidade se chama "dash": Vayne "rolls", Fiora "lunges", Zac "vaults"
  const dashes = countText("dash", "leap", "lunge", "charges toward", "vault", "rolls", "hops", "somersault");
  const blinks = countText("blink", "teleport");
  const speedUps = allMarkers.has("speed") ? countText("move speed", "movement speed") : 0;
  if (dashes) push("DASH", 45 + dashes * 20);
  if (blinks) push("BLINK", 55 + blinks * 20);
  if (speedUps) push("SPEED_BOOST", 35 + speedUps * 15);
  if (!dashes && !blinks) push("IMMOBILE", speedUps ? 55 : 90);

  // --- SUSTAIN: via <healing>/<shield> ---
  const healing = abilities.filter((a) => a.markers.includes("healing")).length;
  const shielding = abilities.filter((a) => a.markers.includes("shield")).length;
  if (healing) {
    const teamHeal = countText("heals the target", "heal an ally", "allies", "nearby allies");
    push(teamHeal ? "TEAM_HEAL" : "SELF_HEAL", 45 + healing * 20);
    if (teamHeal && healing > teamHeal) push("SELF_HEAL", 45);
  }
  if (shielding) push("SHIELD", 45 + shielding * 20);
  if (allMarkers.has("lifeSteal") || allMarkers.has("omnivamp")) push("LIFESTEAL_SCALING", 70);

  // --- PERFIL DE DANO: via marcadores de tipo ---
  const physical = abilities.filter((a) => a.damageTypes.includes("PHYSICAL")).length;
  const magic = abilities.filter((a) => a.damageTypes.includes("MAGIC")).length;
  const trueDmg = abilities.filter((a) => a.damageTypes.includes("TRUE")).length;
  if (physical && magic) push("MIXED_DAMAGE", 60 + Math.min(physical, magic) * 10);
  if (physical) push("AD_DAMAGE", 40 + physical * 15);
  if (magic) push("AP_DAMAGE", 40 + magic * 15);
  if (trueDmg) push("TRUE_DAMAGE", 50 + trueDmg * 20);
  if (countText("each second", "per second", "over ", "burn")) push("DOT", 55);

  // --- BURST x DPS ---
  const onHit = countText("next basic attack", "on-hit", "basic attacks deal", "empowering");
  const damaging = abilities.filter((a) => a.damageTypes.length > 0);
  const spellCooldowns = abilities.flatMap((a) => a.cooldownByRank);
  const avgCooldown = spellCooldowns.length
    ? spellCooldowns.reduce((s, v) => s + v, 0) / spellCooldowns.length
    : 0;

  if (onHit >= 2 || classes.includes("marksman")) push("SUSTAINED_DPS", 50 + onHit * 15);
  if (classes.includes("assassin") || (avgCooldown >= 11 && damaging.length >= 3 && onHit === 0)) {
    push("BURST", classes.includes("assassin") ? 85 : 65);
  }

  // --- PADRÃO DE JOGO ---
  const longRangeSpells = abilities.filter((a) => Math.max(0, ...a.rangeByRank) >= 900).length;
  if (r >= 500 && longRangeSpells >= 2) push("POKE", 45 + longRangeSpells * 15);
  if (hardCc && (dashes || blinks) && r < 300) push("ENGAGE", 75);
  if ((softCc || displacement) && r >= 500) push("DISENGAGE", 60);
  if (dashes && r < 300 && damaging.length >= 3) push("ALL_IN", 70);

  // Escalonamento: acúmulo permanente (Nasus, Veigar, Smolder) é o sinal mais
  // forte; classes que dependem de itens vêm depois.
  const stacks = countText("permanently", "stacks", "stack of", "stacking");
  if (stacks) push("SCALING", 85);
  else if (classes.includes("marksman") || classes.includes("mage")) push("SCALING", 60);

  // Forte cedo: quem já tem padrão de all-in ou burst antes dos itens e não
  // depende de acúmulo. É o outro lado da regra escalonamento × early game.
  const hasEarlyPattern = (dashes && r < 300) || classes.includes("assassin");
  if (hasEarlyPattern && !stacks && !classes.includes("marksman")) push("EARLY_GAME", 70);

  // --- DEFESA: stats base do patch + classe ---
  const bulk = input.hp + (input.armor + input.magicResist) * 12;
  if (classes.includes("tank") || bulk >= 1550) push("TANK", 85);
  else if (classes.includes("fighter") || bulk >= 1350) push("BRUISER", 75);
  else push("SQUISHY", 80);

  // remove duplicatas mantendo o maior peso
  const best = new Map<TagSlug, number>();
  for (const t of out) best.set(t.slug, Math.max(best.get(t.slug) ?? 0, t.weight));
  return [...best].map(([slug, weight]) => ({ slug, weight }));
}

/** Categorias oficiais da Riot → tags de efeito. */
const CATEGORY_MAP: Record<string, TagSlug> = {
  Armor: "ARMOR_ITEM",
  SpellBlock: "MR_ITEM",
  MagicResist: "MR_ITEM",
  Health: "HP_ITEM",
  Tenacity: "TENACITY",
  ArmorPenetration: "ARMOR_PEN",
  MagicPenetration: "MAGIC_PEN",
};

export function deriveItemTags(input: ItemDerivationInput): DerivedTag[] {
  const found = new Map<TagSlug, number>();
  const push = (slug: TagSlug, weight = 100) =>
    found.set(slug, Math.max(found.get(slug) ?? 0, weight));

  for (const category of input.categories) {
    const slug = CATEGORY_MAP[category];
    if (slug) push(slug);
  }

  const t = (input.passiveText ?? "").toLowerCase();
  const has = (...needles: string[]) => needles.some((n) => t.includes(n));

  // a Riot escreve ora "Grievous Wounds", ora só "40% Wounds" (Thornmail)
  if (has("grievous wounds", "wounds")) push("ANTI_HEAL");
  if (has("maximum health", "max health", "current health", "missing health")) push("PERCENT_HP_DMG");
  if (has("shield") && has("reduce", "ignore", "prevent")) push("ANTI_SHIELD");
  if (has("attack speed") && has("reduce", "slow")) push("ANTI_AS");
  if (has("less damage from critical", "damage from critical strikes", "critical strike damage taken"))
    push("ANTI_CRIT");
  if (has("incoming damage from attacks", "less damage from attacks", "damage from attacks by"))
    push("ANTI_AUTO_ATTACK");
  if (has("become invulnerable", "gain a shield", "revive", "stasis")) push("ANTI_BURST");

  // numérico manda quando existe
  if (input.armorPen > 0) push("ARMOR_PEN");
  if (input.magicPen > 0) push("MAGIC_PEN");
  if (input.armor > 0) push("ARMOR_ITEM");
  if (input.magicResist > 0) push("MR_ITEM");
  if (input.health > 0) push("HP_ITEM");
  if (input.tenacity > 0) push("TENACITY");

  return [...found].map(([slug, weight]) => ({ slug, weight }));
}
