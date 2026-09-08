import type { ChampionRef } from "./types";

export type RuneRecommendation = {
  primaryTree: string;
  keystone: string;
  keystoneReason: string;
  secondaryTree: string;
  secondaryReason: string;
};

export function recommendRunes(
  self: ChampionRef | undefined,
  threat: ChampionRef | undefined
): RuneRecommendation | null {
  if (!self) return null;

  let primaryTree = "Precisão";
  let keystone = "Conquistador";
  let keystoneReason = "Ideal para lutas prolongadas e sustentação de dano.";

  const hasTag = (slug: string) => self.tags.some((t) => t.slug === slug && t.weight >= 50);
  const isClass = (cls: string) => self.classes.includes(cls);

  // 1. Inferir Árvore Primária e Keystone
  if (isClass("Assassin") || hasTag("BURST_DAMAGE")) {
    primaryTree = "Dominação";
    keystone = "Eletrocutar";
    keystoneReason = "Maximiza o seu dano explosivo em trocas curtas para eliminar alvos frágeis.";
  } else if (isClass("Marksman")) {
    primaryTree = "Precisão";
    keystone = "Ritmo Fatal / Pressione o Ataque";
    keystoneReason = "Aumenta seu DPS contínuo, essencial para atiradores focados em auto-ataque.";
  } else if (isClass("Mage")) {
    primaryTree = "Feitiçaria";
    keystone = "Cometa Arcano / Invocar Aery";
    keystoneReason = "Aumenta o seu poder de poke e controle de rota à distância.";
  } else if (isClass("Enchanter") || hasTag("TEAM_HEAL") || hasTag("SHIELD")) {
    primaryTree = "Feitiçaria";
    keystone = "Invocar Aery";
    keystoneReason = "Fortalece as suas curas e escudos aliados, além de dar um dano extra no poke.";
  } else if (isClass("Tank")) {
    primaryTree = "Determinação";
    keystone = hasTag("HARD_CC") ? "Pós-Choque" : "Aperto dos Mortos-Vivos";
    keystoneReason = hasTag("HARD_CC")
      ? "Garante uma explosão de resistências assim que você engaja no inimigo."
      : "Fornece sustentação e vida máxima bônus em trocas corpo-a-corpo.";
  } else if (isClass("Fighter")) {
    primaryTree = "Precisão";
    keystone = "Conquistador";
    keystoneReason = "Ideal para o seu perfil de lutador, empilhando dano e cura em lutas estendidas.";
  }

  // 2. Inferir Árvore Secundária defensiva baseada na ameaça
  let secondaryTree = "Inspiração";
  let secondaryReason = "Foco em economia e sustentação na rota (ex: Calçados Mágicos e Biscoitos).";

  if (threat) {
    const threatIsAssassin = threat.classes.includes("Assassin") || threat.tags.some(t => t.slug === "BURST_DAMAGE" && t.weight >= 50);
    const threatIsPoke = threat.tags.some(t => t.slug === "POKE" && t.weight >= 50);

    // Se a ameaça primária for burst ou poke forte, sugerimos Determinação como secundária
    if (threatIsAssassin && primaryTree !== "Determinação") {
      secondaryTree = "Determinação";
      secondaryReason = `Ameaça de explosão de dano (${threat.name}). Use Osso Revestido para sobreviver ao combo dele.`;
    } else if (threatIsPoke && primaryTree !== "Determinação") {
      secondaryTree = "Determinação";
      secondaryReason = `Ameaça de poke constante (${threat.name}). Use Ventos Revigorantes para curar o dano recebido de longe.`;
    }
  }

  return {
    primaryTree,
    keystone,
    keystoneReason,
    secondaryTree,
    secondaryReason,
  };
}
