"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Radio } from "lucide-react";
import type { LeagueState } from "@/engine/league-sync";
import { cn } from "@/lib/utils";

/**
 * Lê `/api/league` em intervalo enquanto a sincronização está ligada.
 *
 * Na partida o intervalo é curto (o ouro e os itens mudam a cada compra);
 * fora dela, com o cliente fechado, a consulta fica mais espaçada para não
 * gastar nada à toa.
 */
/** `undefined` = ainda não houve resposta; `null` = não deu para ler. */
export function useLeagueState(enabled: boolean): LeagueState | null | undefined {
  const [state, setState] = useState<LeagueState | null | undefined>(undefined);

  useEffect(() => {
    if (!enabled) {
      setState(undefined);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      let next: LeagueState | null = null;
      try {
        const res = await fetch("/api/league", { cache: "no-store" });
        if (res.ok) next = (await res.json()) as LeagueState;
      } catch {
        /* servidor reiniciando: tenta de novo no próximo ciclo */
      }
      if (cancelled) return;
      setState(next);
      // hospedado: o servidor nunca vai ver o LoL deste PC — não adianta insistir
      if (next?.hosted) return;
      const busy = next?.live || next?.champSelect;
      timer = setTimeout(tick, busy ? 2000 : next?.client ? 4000 : 8000);
    };

    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled]);

  return state;
}

function formatClock(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Link da revisão da última partida, quando o cliente sabe qual foi. */
export function lastGameHref(state: LeagueState | null | undefined): string | null {
  if (!state?.lastGameId || !state.identity?.platform) return null;
  const matchId = `${state.identity.platform.toUpperCase()}_${state.lastGameId}`;
  return `/partida/${matchId}?puuid=${encodeURIComponent(state.identity.puuid)}`;
}

export function SyncBar({
  enabled,
  state,
  onToggle,
}: {
  enabled: boolean;
  state: LeagueState | null | undefined;
  onToggle: (enabled: boolean) => void;
}) {
  let tone: "off" | "idle" | "on" = "off";
  let text = "Sincronização desligada: preencha a partida à mão.";

  if (state?.hosted) {
    return (
      <div className="panel-plain flex items-start gap-3 px-3 py-2">
        <span className="bg-muted-foreground/40 mt-1.5 inline-flex size-2 shrink-0 rounded-full" />
        <p className="text-muted-foreground text-[11px] leading-relaxed">
          A sincronização automática com o LoL funciona com o Riftando rodando no seu PC (
          <code className="bg-muted rounded px-1">npm run dev</code>), onde o jogo está aberto — um
          site na internet não enxerga o seu cliente. Aqui, preencha a partida à mão.
        </p>
      </div>
    );
  }

  if (enabled) {
    if (state === undefined) {
      tone = "idle";
      text = "Procurando o LoL nesta máquina…";
    } else if (state?.live) {
      tone = "on";
      text = `Partida ao vivo · ${formatClock(state.live.gameTimeSec)} — itens, nível e ouro vêm do jogo`;
    } else if (state?.champSelect) {
      tone = "on";
      text = "Seleção de campeões — picks e bans vêm do cliente";
    } else if (state?.client) {
      tone = "idle";
      text = state.identity
        ? `Cliente aberto (${state.identity.gameName}) — esperando a seleção de campeões`
        : "Cliente aberto — esperando a seleção de campeões";
    } else {
      tone = "idle";
      text = "LoL fechado nesta máquina — abra o cliente ou preencha à mão.";
    }
  }

  const review = enabled ? lastGameHref(state) : null;

  return (
    <div className="panel-plain flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
      <span
        className={cn(
          "relative inline-flex size-2 shrink-0 rounded-full",
          tone === "on" && "bg-advantage",
          tone === "idle" && "bg-even",
          tone === "off" && "bg-muted-foreground/40",
        )}
      >
        {tone === "on" && (
          <span className="bg-advantage absolute inset-0 animate-ping rounded-full opacity-60" />
        )}
      </span>
      <p className="text-muted-foreground min-w-0 flex-1 text-[11px]">{text}</p>

      {review && !state?.live && !state?.champSelect && (
        <Link
          href={review}
          className="border-gold/60 text-gold hover:bg-gold/10 rounded-sm border px-2 py-1 text-[11px] font-medium"
        >
          Revisar última partida →
        </Link>
      )}

      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={() => onToggle(!enabled)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[11px] font-medium transition-colors",
          enabled
            ? "border-gold/60 text-gold bg-gold/10"
            : "border-border text-muted-foreground hover:text-foreground",
        )}
      >
        <Radio className="size-3" />
        {enabled ? "Sincronizando" : "Sincronizar com o LoL"}
      </button>
    </div>
  );
}
