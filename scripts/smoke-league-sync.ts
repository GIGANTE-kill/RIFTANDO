/**
 * Sincronização com o cliente do LoL, contra o banco real e os dados gravados
 * em scripts/fixtures — não precisa do jogo aberto.
 *   npm run sync:smoke
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import path from "node:path";
import { getCatalog } from "../src/db/queries/catalog";
import { draftFromChampSelect, matchFromLive } from "../src/engine/league-sync";
import { readLiveGame } from "../src/lib/league/live-client";
import { readClientState } from "../src/lib/league/lcu";
import { ROLES, ROLE_LABEL } from "../src/engine/match";

async function main() {
  const payload = await getCatalog();
  if (!payload) throw new Error("Banco vazio: rode npm run sync");
  const champions = new Map(payload.champions.map((c) => [c.id, c]));
  const items = new Map(payload.items.map((i) => [i.id, i]));
  const name = (id: string | null) => (id ? (champions.get(id)?.name ?? id) : "—");

  process.env.RIFTANDO_LCU_FIXTURE = path.resolve("scripts/fixtures/lcu-champselect.json");
  const client = await readClientState();
  if (!client?.champSelect) throw new Error("fixture de seleção não carregou");
  const draft = draftFromChampSelect(client.champSelect, champions);
  console.log(`Seleção — minha rota: ${draft.myRole}, bans: ${draft.bans.map(name).join(", ")}`);
  for (const r of ROLES)
    console.log(`  ${ROLE_LABEL[r].padEnd(9)} ${name(draft.allies[r]).padEnd(12)} × ${name(draft.enemies[r])}`);

  process.env.RIFTANDO_LIVE_FIXTURE = path.resolve("scripts/fixtures/live-allgamedata.json");
  const live = await readLiveGame();
  if (!live) throw new Error("fixture de partida não carregou");
  const match = matchFromLive(live, champions, items);
  if (!match) throw new Error("não achou o jogador ativo");
  console.log(
    `\nPartida — minuto ${match.minute}, você é ${ROLE_LABEL[match.myRole]} (nível ${match.myLevel}, ${match.myGold} de ouro)`,
  );
  for (const r of ROLES) {
    const a = match.allies[r];
    const e = match.enemies[r];
    const list = (ids: number[] = []) => ids.map((i) => items.get(i)?.name ?? `?${i}`).join(", ");
    console.log(`  ${ROLE_LABEL[r].padEnd(9)} ${name(a).padEnd(10)} [${list(a ? match.allyItems[a] : [])}]`);
    console.log(`  ${"".padEnd(9)} ${name(e).padEnd(10)} [${list(e ? match.enemyItems[e] : [])}]`);
  }

  // o que precisa dar certo — se quebrar, o script falha
  const expect = (cond: boolean, what: string) => {
    if (!cond) throw new Error(`FALHOU: ${what}`);
  };
  expect(draft.myRole === "MID", "rota do jogador vem do cliente");
  expect(draft.allies.TOP === "Garen" && draft.allies.ADC === "Jinx", "aliados nas rotas atribuídas");
  expect(draft.enemies.MID === "Zed" && draft.enemies.SUPPORT === "Lux", "Lux vai para o suporte porque Zed ocupa o meio");
  expect(draft.bans.length === 2, "bans vêm das ações concluídas");
  expect(match.myRole === "MID" && match.allies.MID === "Ahri", "jogador ativo reconhecido");
  expect(match.enemies.JUNGLE === "Vi", "quem leva Golpear é o caçador");
  expect(match.enemies.SUPPORT === "Lux" && match.enemies.MID === "Zed", "rotas inimigas inferidas na partida");
  expect(!match.allyItems.Ahri.includes(2003), "poção não conta como item");
  expect(match.minute === 18, "minuto vem do relógio do jogo");

  // travas: o jogador corrige a inferência e a sincronização respeita
  const amumuId = champions.get("Amumu")!.riotId;
  const withAmumu = {
    ...client.champSelect,
    theirTeam: [
      { cellId: 5, championId: amumuId, assignedPosition: "" },
      { cellId: 7, championId: champions.get("Zed")!.riotId, assignedPosition: "" },
    ],
  };
  const guessed = draftFromChampSelect(withAmumu, champions);
  console.log(`
Amumu inimigo sem correção: ${ROLES.find((r) => guessed.enemies[r] === "Amumu")}`);
  expect(guessed.enemies.TOP !== "Amumu", "sem trava, Amumu não vai para o topo (não é a rota dele)");
  const locked = draftFromChampSelect(withAmumu, champions, undefined, {
    ally: { Garen: "SUPPORT" },
    enemy: { Amumu: "TOP" },
  });
  expect(locked.enemies.TOP === "Amumu", "trava põe o Amumu inimigo no topo");
  expect(locked.allies.SUPPORT === "Garen" && locked.allies.TOP === null, "trava vence a rota que o lobby informou");
  const liveLocked = matchFromLive(live, champions, items, undefined, {
    ally: {},
    enemy: { Vi: "TOP", Darius: "JUNGLE" },
  })!;
  expect(liveLocked.enemies.TOP === "Vi" && liveLocked.enemies.JUNGLE === "Darius", "trava vale dentro da partida, até contra Golpear");
  console.log("travas ok: Amumu no topo, Garen de suporte, Vi no topo na partida");
  console.log("\nok — todas as verificações passaram");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
