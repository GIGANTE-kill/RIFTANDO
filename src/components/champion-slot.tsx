"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { EntityPicker, type PickerEntry } from "@/components/entity-picker";
import { tagLabel } from "@/engine/tag-catalog";
import type { ChampionRef } from "@/engine/types";
import { cn } from "@/lib/utils";

/** Retrato de campeão com busca embutida, usado em todos os slots de time. */
export function ChampionSlot({
  label,
  hint,
  champion,
  entries,
  onChange,
  size = "md",
  tone = "neutral",
}: {
  label: string;
  hint?: string;
  champion?: ChampionRef;
  entries: PickerEntry[];
  onChange: (id: string | null) => void;
  size?: "sm" | "md";
  tone?: "neutral" | "ally" | "enemy";
}) {
  const [open, setOpen] = useState(false);

  const toneRing =
    tone === "ally"
      ? "border-hex/50"
      : tone === "enemy"
        ? "border-disadvantage/50"
        : "border-border-strong";

  const portraitSize = size === "sm" ? "size-11" : "size-14";

  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
        {label}
      </p>

      {champion ? (
        <div className={cn("panel-plain flex items-center gap-2.5 p-2", toneRing)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={champion.iconUrl ?? ""} alt="" className={cn("portrait", portraitSize)} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{champion.name}</p>
            <p className="text-muted-foreground truncate text-[10px] leading-tight">
              {champion.tags
                .slice(0, 2)
                .map((t) => tagLabel(t.slug))
                .join(" · ")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-muted-foreground hover:text-disadvantage shrink-0 p-1"
            aria-label={`Remover ${champion.name}`}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : open ? (
        <div className="panel-plain space-y-2 p-2">
          <EntityPicker
            entries={entries}
            onPick={(id) => {
              onChange(String(id));
              setOpen(false);
            }}
            placeholder="Digite o nome…"
            columns={6}
            autoFocus
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-muted-foreground hover:text-foreground w-full text-center text-[11px]"
          >
            cancelar
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "portrait-empty hover:border-gold/60 w-full gap-2 px-2 py-2.5 transition-colors",
            toneRing,
          )}
        >
          <span className={cn("portrait-empty text-muted-foreground/60 text-lg", portraitSize)}>
            +
          </span>
          <span className="text-muted-foreground text-left text-[11px] leading-tight">
            {hint ?? "Escolher"}
          </span>
        </button>
      )}
    </div>
  );
}
