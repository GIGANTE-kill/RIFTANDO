/**
 * Coletor de partidas ranqueadas reais, pela API oficial da Riot.
 *
 *   npm run crawl -- --platform br1 --matches 2000
 *
 * Começa pelos jogadores Desafiante/Grão-Mestre/Mestre e segue "em bola de
 * neve" pelos participantes de cada partida. Só conta para a meta a partida do
 * patch atual; nada é baixado duas vezes, então dá para parar (Ctrl+C) e
 * retomar quando quiser.
 *
 * ⚠️ Com PGlite, pare o `npm run dev` antes — o banco embutido aceita um
 * processo escrevendo por vez.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { patches } from "../src/db/schema";
import { missingMatchIds, patchOf, storeMatch } from "../src/db/queries/matches";
import {
  RANKED_SOLO,
  RiotApiError,
  isPlatform,
  riotApi,
  type Platform,
} from "../src/lib/riot/client";

/** "16.17" vs "16.18": negativo se a < b */
function comparePatch(a: string, b: string) {
  const [a1, a2] = a.split(".").map(Number);
  const [b1, b2] = b.split(".").map(Number);
  return a1 - b1 || a2 - b2;
}

function arg(name: string, fallback: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const platformArg = arg("platform", process.env.RIOT_PLATFORM ?? "br1").toLowerCase();
  if (!isPlatform(platformArg)) throw new Error(`Servidor desconhecido: ${platformArg}`);
  const platform: Platform = platformArg;
  const target = Number(arg("matches", "1000"));
  const perPlayer = Number(arg("per-player", "20"));
  const tiers = arg("tiers", "challenger,grandmaster,master").split(",") as (
    | "challenger"
    | "grandmaster"
    | "master"
  )[];

  const [current] = await db.select().from(patches).where(eq(patches.isCurrent, true)).limit(1);
  if (!current) throw new Error("Banco vazio: rode npm run sync antes");
  const patch = patchOf(current.version);
  // duas semanas cobrem um patch inteiro com folga
  const startTime = Math.floor(Date.now() / 1000) - 14 * 24 * 3600;

  console.log(`Coletando ${target} partidas do patch ${patch} em ${platform.toUpperCase()}…`);

  const queue: string[] = [];
  for (const tier of tiers) {
    const league = await riotApi.apexLeague(platform, tier);
    const puuids = (league?.entries ?? [])
      .filter((e) => e.puuid)
      .sort((a, b) => b.leaguePoints - a.leaguePoints)
      .map((e) => e.puuid);
    queue.push(...puuids);
    console.log(`  ${tier}: ${puuids.length} jogadores`);
  }
  if (!queue.length) throw new Error("Nenhum jogador de elo alto encontrado para começar.");

  const seen = new Set(queue);
  const t0 = Date.now();
  let stored = 0;
  let otherPatch = 0;
  let players = 0;
  let warnedNewer = false;

  while (queue.length && stored < target) {
    const puuid = queue.shift()!;
    players++;
    const ids = (await riotApi.matchIds(platform, puuid, { count: perPlayer, queue: RANKED_SOLO, startTime })) ?? [];

    for (const id of await missingMatchIds(ids)) {
      if (stored >= target) break;
      const match = await riotApi.match(platform, id);
      if (!match) continue;
      await storeMatch(match);

      const matchPatch = patchOf(match.info.gameVersion);
      if (comparePatch(matchPatch, patch) < 0) {
        otherPatch++;
        // a lista vem da mais nova para a mais velha: daqui para trás é patch antigo
        break;
      }
      if (comparePatch(matchPatch, patch) > 0 && !warnedNewer) {
        warnedNewer = true;
        console.log(
          `  ⚠ o jogo já está no patch ${matchPatch} e o banco no ${patch} — rode npm run sync para atualizar stats e itens.`,
        );
      }
      stored++;

      // bola de neve: os outros nove jogadores entram na fila
      if (queue.length < 2000)
        for (const p of match.info.participants)
          if (!seen.has(p.puuid)) {
            seen.add(p.puuid);
            queue.push(p.puuid);
          }

      if (stored % 25 === 0) {
        const perHour = Math.round((stored / (Date.now() - t0)) * 3_600_000);
        console.log(
          `  ${stored}/${target} partidas · ${players} jogadores · ~${perHour.toLocaleString("pt-BR")}/hora`,
        );
      }
    }
  }

  const minutes = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(
    `\nPronto: ${stored} partidas do patch ${patch} em ${minutes} min` +
      (otherPatch ? ` (${otherPatch} de outro patch guardadas à parte)` : "") +
      `.\nAbra /estatisticas para ver.`,
  );
  process.exit(0);
}

main().catch((e) => {
  if (e instanceof RiotApiError) console.error(`\n${e.message}`);
  else console.error(e);
  process.exit(1);
});
