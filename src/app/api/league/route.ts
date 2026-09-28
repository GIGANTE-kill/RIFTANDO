import { NextResponse } from "next/server";
import { readClientState } from "@/lib/league/lcu";
import { readLiveGame } from "@/lib/league/live-client";
import type { LeagueState } from "@/engine/league-sync";

export const dynamic = "force-dynamic";

/**
 * Tudo o que o LoL aberto nesta máquina informa, numa leitura só. O navegador
 * consulta a cada poucos segundos; cada leitura custa milissegundos porque
 * não sai de 127.0.0.1.
 */
export async function GET() {
  if (process.env.VERCEL) {
    const body: LeagueState = {
      hosted: true,
      client: false,
      phase: null,
      identity: null,
      champSelect: null,
      live: null,
      lastGameId: null,
    };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  }

  const [client, live] = await Promise.all([readClientState(), readLiveGame()]);

  const body: LeagueState = {
    hosted: false,
    client: Boolean(client),
    phase: client?.phase ?? (live ? "InProgress" : null),
    identity: client?.identity ?? null,
    champSelect: client?.champSelect ?? null,
    live,
    lastGameId: client?.lastGameId ?? null,
  };

  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
