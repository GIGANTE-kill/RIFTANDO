"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export type PickerEntry = {
  id: string | number;
  name: string;
  iconUrl: string | null;
  subtitle?: string;
};

/**
 * Busca com retrato, para campeões e itens. Filtra no cliente sobre o catálogo
 * já carregado — sem espera de rede a cada tecla.
 */
export function EntityPicker({
  entries,
  onPick,
  placeholder,
  emptyLabel = "Nada encontrado",
  columns = 6,
  autoFocus = false,
}: {
  entries: PickerEntry[];
  onPick: (id: string | number) => void;
  placeholder: string;
  emptyLabel?: string;
  columns?: number;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries.slice(0, 24);
    // prefixo primeiro: digitar "mor" traz Morellonomicon antes de Armadura
    const starts: PickerEntry[] = [];
    const contains: PickerEntry[] = [];
    for (const entry of entries) {
      const name = entry.name.toLowerCase();
      if (name.startsWith(q)) starts.push(entry);
      else if (name.includes(q)) contains.push(entry);
    }
    return [...starts, ...contains].slice(0, 24);
  }, [entries, query]);

  return (
    <div className="space-y-2">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="border-input bg-background/60 focus-visible:border-gold/60 h-9 w-full rounded-sm border px-2.5 text-sm outline-none"
      />
      {results.length === 0 ? (
        <p className="text-muted-foreground px-1 py-2 text-xs">{emptyLabel}</p>
      ) : (
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {results.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => {
                onPick(entry.id);
                setQuery("");
              }}
              title={entry.subtitle ? `${entry.name} — ${entry.subtitle}` : entry.name}
              className={cn(
                "group hover:border-gold/70 flex flex-col items-center gap-1 rounded-sm",
                "border border-transparent p-1 transition-colors",
              )}
            >
              {entry.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={entry.iconUrl}
                  alt=""
                  loading="lazy"
                  className="portrait aspect-square w-full"
                />
              ) : (
                <div className="bg-muted aspect-square w-full rounded-sm" />
              )}
              <span className="w-full truncate text-center text-[9px] leading-tight">
                {entry.name}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
