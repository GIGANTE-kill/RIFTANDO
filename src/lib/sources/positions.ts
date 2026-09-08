/**
 * Em que rota cada campeão é jogado.
 *
 * A Riot não publica isso em lugar nenhum: nem o Data Dragon nem o
 * CommunityDragon dizem que Lux joga no meio e no suporte. A única fonte
 * pública é a Meraki, cujo `champions.json` está congelado desde agosto de 2025.
 *
 * Isso é aceitável AQUI e em nenhum outro lugar: a rota de um campeão muda
 * devagar (Aatrox era topo em 2025 e continua topo), enquanto os números de
 * dano mudam todo patch — por isso os stats vêm do Data Dragon e só as rotas
 * vêm daqui. Campeão que a Meraki não conhece cai no palpite por classe.
 */
import { z } from "zod";
import { fetchJson } from "./ddragon";

const MERAKI = "https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US";

export type Lane = "TOP" | "JUNGLE" | "MID" | "ADC" | "SUPPORT";

const MERAKI_TO_LANE: Record<string, Lane> = {
  TOP: "TOP",
  JUNGLE: "JUNGLE",
  MIDDLE: "MID",
  BOTTOM: "ADC",
  SUPPORT: "SUPPORT",
};

/** Palpite por classe, para campeões novos que a Meraki ainda não tem. */
export function guessLanes(classes: string[]): Lane[] {
  const set = new Set<Lane>();
  for (const c of classes) {
    switch (c) {
      case "Marksman":
        set.add("ADC");
        break;
      case "Support":
        set.add("SUPPORT");
        break;
      case "Mage":
        set.add("MID");
        set.add("SUPPORT");
        break;
      case "Assassin":
        set.add("MID");
        set.add("JUNGLE");
        break;
      case "Fighter":
        set.add("TOP");
        set.add("JUNGLE");
        break;
      case "Tank":
        set.add("TOP");
        set.add("SUPPORT");
        break;
    }
  }
  return set.size ? [...set] : ["MID"];
}

export async function fetchLanes(): Promise<Map<string, Lane[]>> {
  const raw = await fetchJson(
    `${MERAKI}/champions.json`,
    z.record(
      z.string(),
      z.object({ key: z.string(), positions: z.array(z.string()).default([]) }).passthrough(),
    ),
  );

  const out = new Map<string, Lane[]>();
  for (const champion of Object.values(raw)) {
    const lanes = champion.positions
      .map((p) => MERAKI_TO_LANE[p.toUpperCase()])
      .filter((l): l is Lane => Boolean(l));
    if (lanes.length) out.set(champion.key, lanes);
  }
  return out;
}
