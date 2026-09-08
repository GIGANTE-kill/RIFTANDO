"use client";

import { useMemo, useState } from "react";
import { Ban, Sparkles, X } from "lucide-react";
import { EntityPicker, type PickerEntry } from "@/components/entity-picker";
import { suggestPicks, estimateWinChance, type DraftBoard } from "@/engine/draft";
import type { MatchupCatalog } from "@/engine/matchup";
import { ROLES, ROLE_LABEL, type Role, type TeamSlots } from "@/engine/match";
import { tagLabel } from "@/engine/tag-catalog";
import type { ChampionRef } from "@/engine/types";
import { cn } from "@/lib/utils";

const DIFFICULTY_LABEL: Record<number, string> = { 1: "fácil", 2: "média", 3: "difícil" };

export function DraftPhase({
  catalog,
  entries,
  myRole,
  allies,
  enemies,
  bans,
  onRole,
  onAlly,
  onEnemy,
  onBans,
}: {
  catalog: MatchupCatalog;
  entries: PickerEntry[];
  myRole: Role;
  allies: TeamSlots;
  enemies: TeamSlots;
  bans: string[];
  onRole: (role: Role) => void;
  onAlly: (role: Role, id: string | null) => void;
  onEnemy: (role: Role, id: string | null) => void;
  onBans: (bans: string[]) => void;
}) {
  // a rota cujas sugestões estão abertas — por padrão a sua
  const [focusRole, setFocusRole] = useState<Role>(myRole);
  const [focusSide, setFocusSide] = useState<"ALLY" | "ENEMY">("ALLY");

  const board: DraftBoard = useMemo(
    () => ({ myRole, allies, enemies, bans }),
    [myRole, allies, enemies, bans],
  );

  /**
   * De quem são as sugestões exibidas.
   *
   * Quando você clica num slot inimigo é para registrar o que ELE pegou — e é
   * exatamente aí que você quer saber o que pegar em resposta. Então o painel
   * nunca segue o time inimigo: ele volta para a sua rota, ou para a próxima
   * rota vazia do seu time se a sua já estiver preenchida.
   */
  const suggestionRole: Role = useMemo(() => {
    if (focusSide === "ALLY") return focusRole;
    if (!allies[myRole]) return myRole;
    return ROLES.find((r) => !allies[r]) ?? myRole;
  }, [focusSide, focusRole, allies, myRole]);

  const suggestions = useMemo(
    () => suggestPicks({ role: suggestionRole, board, catalog }),
    [suggestionRole, board, catalog],
  );

  /**
   * A lista dentro do slot vem filtrada pela rota e já na ordem recomendada —
   * a seleção dura segundos, ninguém tem tempo de procurar num alfabeto de 173.
   */
  const entriesForRole = (role: Role, side: "ALLY" | "ENEMY"): PickerEntry[] => {
    const eligible = entries.filter((e) => {
      const champion = catalog.champions.get(String(e.id));
      return champion?.positions.includes(role);
    });
    if (side === "ENEMY") return eligible;

    const ranked = suggestPicks({ role, board, catalog, limit: 999 });
    const order = new Map(ranked.map((s, i) => [s.champion.id, i]));
    return [...eligible].sort(
      (a, b) => (order.get(String(a.id)) ?? 999) - (order.get(String(b.id)) ?? 999),
    );
  };

  const estimate = useMemo(() => estimateWinChance(board, catalog), [board, catalog]);

  const pickedCount =
    Object.values(allies).filter(Boolean).length + Object.values(enemies).filter(Boolean).length;

  return (
    <div className="space-y-6">
      <BanRow catalog={catalog} entries={entries} bans={bans} onBans={onBans} />

      <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr]">
        <TeamColumn
          title="Seu time"
          tone="ally"
          slots={allies}
          catalog={catalog}
          entries={entries}
          entriesForRole={(role) => entriesForRole(role, "ALLY")}
          myRole={myRole}
          onPick={(role, id) => onAlly(role, id)}
          onFocus={(role) => {
            setFocusRole(role);
            setFocusSide("ALLY");
          }}
          focusRole={focusSide === "ALLY" ? focusRole : null}
          onSetMyRole={(role) => {
            onRole(role);
            setFocusRole(role);
            setFocusSide("ALLY");
          }}
        />

        <div className="hidden lg:flex lg:items-center">
          <div className="via-gold/40 h-full w-px bg-gradient-to-b from-transparent to-transparent" />
        </div>

        <TeamColumn
          title="Time inimigo"
          tone="enemy"
          slots={enemies}
          catalog={catalog}
          entries={entries}
          entriesForRole={(role) => entriesForRole(role, "ENEMY")}
          onPick={(role, id) => onEnemy(role, id)}
          onFocus={(role) => {
            setFocusRole(role);
            setFocusSide("ENEMY");
          }}
          focusRole={focusSide === "ENEMY" ? focusRole : null}
        />
      </div>

      <Suggestions
        role={suggestionRole}
        suggestions={suggestions}
        isMyRole={suggestionRole === myRole}
        alreadyPicked={Boolean(allies[suggestionRole])}
        onPick={(id) => onAlly(suggestionRole, id)}
      />

      {pickedCount >= 2 && <WinBar estimate={estimate} />}
    </div>
  );
}

/* ------------------------------------------------------------------ bans */

function BanRow({
  catalog,
  entries,
  bans,
  onBans,
}: {
  catalog: MatchupCatalog;
  entries: PickerEntry[];
  bans: string[];
  onBans: (bans: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <section className="panel-plain p-3">
      <div className="mb-2 flex items-center gap-2">
        <Ban className="text-muted-foreground size-3.5" />
        <p className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
          Banidos ({bans.length})
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {bans.map((id) => {
          const champion = catalog.champions.get(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => onBans(bans.filter((b) => b !== id))}
              title={`Desbanir ${champion?.name ?? id}`}
              className="relative"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={champion?.iconUrl ?? ""}
                alt={champion?.name ?? ""}
                className="portrait size-9 opacity-40 grayscale"
              />
              <X className="text-disadvantage absolute inset-0 m-auto size-5" />
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "portrait-empty text-muted-foreground/70 size-9 text-lg",
            open && "border-gold/60 text-gold",
          )}
          aria-label="Adicionar banido"
        >
          {open ? <X className="size-4" /> : "+"}
        </button>
      </div>

      {open && (
        <div className="mt-2">
          <EntityPicker
            entries={entries.filter((e) => !bans.includes(String(e.id)))}
            onPick={(id) => {
              onBans([...bans, String(id)]);
              setOpen(false);
            }}
            placeholder="Quem foi banido…"
            columns={10}
            autoFocus
          />
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ times */

function TeamColumn({
  title,
  tone,
  slots,
  catalog,
  entries,
  entriesForRole,
  myRole,
  focusRole,
  onPick,
  onFocus,
  onSetMyRole,
}: {
  title: string;
  tone: "ally" | "enemy";
  slots: TeamSlots;
  catalog: MatchupCatalog;
  entries: PickerEntry[];
  entriesForRole: (role: Role) => PickerEntry[];
  myRole?: Role;
  focusRole: Role | null;
  onPick: (role: Role, id: string | null) => void;
  onFocus: (role: Role) => void;
  onSetMyRole?: (role: Role) => void;
}) {
  const [openRole, setOpenRole] = useState<Role | null>(null);

  return (
    <section className="panel space-y-2 p-3">
      <p
        className={cn(
          "text-[10px] font-medium tracking-wider uppercase",
          tone === "ally" ? "text-hex" : "text-disadvantage",
        )}
      >
        {title}
      </p>

      {ROLES.map((role) => {
        const id = slots[role];
        const champion = id ? catalog.champions.get(id) : undefined;
        const isMine = myRole === role;

        return (
          <div
            key={role}
            className={cn(
              "flex items-center gap-2 rounded-sm border p-1.5 transition-colors",
              focusRole === role ? "border-gold/60 bg-gold/5" : "border-transparent",
              isMine && "bg-hex/5",
            )}
          >
            <button
              type="button"
              onClick={() => onSetMyRole?.(role)}
              disabled={!onSetMyRole}
              title={onSetMyRole ? "Definir como minha rota" : undefined}
              className={cn(
                "w-16 shrink-0 text-left text-[11px] font-medium",
                isMine ? "text-gold" : "text-muted-foreground",
                onSetMyRole && "hover:text-gold",
              )}
            >
              {ROLE_LABEL[role]}
              {isMine && <span className="block text-[9px] leading-none">você</span>}
            </button>

            {champion ? (
              <button
                type="button"
                onClick={() => onPick(role, null)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                title={`Remover ${champion.name}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={champion.iconUrl ?? ""} alt="" className="portrait size-9" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{champion.name}</span>
                  <span className="text-muted-foreground block truncate text-[10px]">
                    {champion.tags
                      .slice(0, 2)
                      .map((t) => tagLabel(t.slug))
                      .join(" · ")}
                  </span>
                </span>
                <X className="text-muted-foreground size-3.5 shrink-0" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setOpenRole(openRole === role ? null : role);
                  onFocus(role);
                }}
                className={cn(
                  "portrait-empty hover:border-gold/60 h-9 flex-1 justify-start gap-2 px-2 text-[11px]",
                  openRole === role && "border-gold/60",
                )}
              >
                <span className="text-muted-foreground/60">+</span>
                <span className="text-muted-foreground">escolher</span>
              </button>
            )}
          </div>
        );
      })}

      {openRole && (
        <div className="panel-plain p-2">
          <EntityPicker
            entries={entriesForRole(openRole)}
            onPick={(id) => {
              onPick(openRole, String(id));
              setOpenRole(null);
            }}
            placeholder={`Campeão para ${ROLE_LABEL[openRole].toLowerCase()}…`}
            emptyLabel="Nenhum campeão dessa rota bate com a busca"
            columns={6}
            autoFocus
          />
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- sugestões */

function Suggestions({
  role,
  suggestions,
  isMyRole,
  alreadyPicked,
  onPick,
}: {
  role: Role;
  suggestions: ReturnType<typeof suggestPicks>;
  isMyRole: boolean;
  alreadyPicked: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="rule-heading flex-1">
          <Sparkles className="size-3.5" />
          {alreadyPicked
            ? `Trocar ${ROLE_LABEL[role].toLowerCase()}`
            : isMyRole
              ? "O que pegar agora"
              : `Sugestões para ${ROLE_LABEL[role].toLowerCase()}`}
        </h3>
      </div>

      {suggestions.length === 0 ? (
        <p className="panel-plain text-muted-foreground border-dashed p-4 text-center text-xs">
          Nenhum campeão disponível para essa rota.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {suggestions.map((s, i) => (
            <button
              key={s.champion.id}
              type="button"
              onClick={() => onPick(s.champion.id)}
              className={cn(
                "panel-plain hover:border-gold/60 flex gap-2.5 p-2.5 text-left transition-colors",
                i === 0 && "panel",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.champion.iconUrl ?? ""} alt="" className="portrait size-11 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <p className="truncate text-sm font-medium">{s.champion.name}</p>
                  {s.champion.difficulty && (
                    <span className="text-muted-foreground/70 shrink-0 text-[9px]">
                      {DIFFICULTY_LABEL[s.champion.difficulty]}
                    </span>
                  )}
                </div>
                <ul className="mt-0.5 space-y-0.5">
                  {s.reasons.map((reason, j) => (
                    <li key={j} className="text-muted-foreground text-[10px] leading-snug">
                      {reason}
                    </li>
                  ))}
                </ul>
              </div>
            </button>
          ))}
        </div>
      )}

      <p className="text-muted-foreground/60 text-[10px] leading-relaxed">
        Isto não é uma lista dos campeões mais fortes do patch — taxa de vitória real só existe em
        serviço pago. É quem melhor responde ao que já está no quadro: confronto direto, buraco na
        sua composição e combinação com a sua dupla.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ chance */

function WinBar({ estimate }: { estimate: ReturnType<typeof estimateWinChance> }) {
  const tone =
    estimate.chance >= 55
      ? "text-advantage"
      : estimate.chance > 45
        ? "text-even"
        : "text-disadvantage";

  return (
    <section className="panel space-y-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-muted-foreground text-[10px] tracking-wider uppercase">
            Leitura da composição
          </p>
          <p className={cn("font-display text-xl", tone)}>{estimate.label}</p>
        </div>
        <p className={cn("font-mono text-2xl tabular-nums", tone)}>{estimate.chance}%</p>
      </div>

      <div className="bg-disadvantage/25 h-2 overflow-hidden rounded-full">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            estimate.chance >= 55
              ? "bg-advantage"
              : estimate.chance > 45
                ? "bg-even"
                : "bg-disadvantage",
          )}
          style={{ width: `${estimate.chance}%` }}
        />
      </div>

      {estimate.factors.length > 0 && (
        <ul className="border-border-strong grid gap-1 border-t pt-3 sm:grid-cols-2">
          {estimate.factors.map((f, i) => (
            <li key={i} className="flex gap-2 text-[11px]">
              <span
                className={cn(
                  "w-9 shrink-0 text-right font-mono tabular-nums",
                  f.delta > 0 ? "text-advantage" : "text-disadvantage",
                )}
              >
                {f.delta > 0 ? "+" : ""}
                {Math.round(f.delta * 10) / 10}
              </span>
              <span className="text-muted-foreground">{f.label}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-muted-foreground/60 text-[10px] leading-relaxed">
        Confiança {estimate.confidence.toLowerCase()} — baseada em {estimate.factors.length}{" "}
        fator(es). É leitura de composição, não previsão de resultado: quem joga melhor ainda ganha.
      </p>
    </section>
  );
}
