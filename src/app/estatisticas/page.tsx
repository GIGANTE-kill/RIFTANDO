import Link from "next/link";
import { getCatalog } from "@/db/queries/catalog";
import { getItemStats } from "@/db/queries/matches";
import { ROLES, ROLE_LABEL, type Role } from "@/engine/match";
import { analyzeMatchup } from "@/engine/matchup";
import {
  MIN_MATCHUP_GAMES,
  MIN_ROLE_GAMES,
  formatGames,
  formatMatches,
  formatRate,
  shrunkWinRate,
  type StatsPayload,
} from "@/engine/stats";
import type { ChampionRef, ItemRef } from "@/engine/types";
import { engineCatalogs } from "@/lib/engine-catalogs";
import { ChampIcon } from "@/components/match-bits";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Estatísticas — Riftando" };

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ rota?: string; campeao?: string }>;
}) {
  const sp = await searchParams;
  const role: Role = (ROLES as readonly string[]).includes(sp.rota ?? "") ? (sp.rota as Role) : "MID";
  const payload = await getCatalog();

  if (!payload?.stats)
    return (
      <Shell>
        <div className="panel mx-auto max-w-xl space-y-3 p-5 text-sm">
          <p className="font-display text-gold text-lg">Ainda não há partidas coletadas</p>
          <p className="text-muted-foreground leading-relaxed">
            A estatística do Riftando vem de partidas ranqueadas reais, baixadas pela API oficial da
            Riot — nada de raspagem. Com a chave no <code className="bg-muted rounded px-1">.env.local</code>:
          </p>
          <pre className="bg-background/70 overflow-x-auto rounded-sm p-3 text-xs">
            npm run crawl -- --platform br1 --matches 2000
          </pre>
          <p className="text-muted-foreground text-xs leading-relaxed">
            O coletor começa pelos jogadores Desafiante e Grão-Mestre e segue pelas partidas deles. Com a
            chave de desenvolvimento rende perto de 2 mil partidas por hora; pode parar e retomar quando quiser,
            nada é baixado duas vezes. A partir de algumas centenas de partidas os números começam a
            aparecer aqui e no assistente de seleção.
          </p>
        </div>
      </Shell>
    );

  const stats = payload.stats;
  const { matchupCatalog } = engineCatalogs(payload);
  const index = matchupCatalog.stats!;
  const champions = matchupCatalog.champions;

  const rows = stats.roleStats
    .filter((r) => r.role === role)
    .map((r) => ({
      ...r,
      champion: champions.get(r.championId),
      raw: r.wins / r.games,
      adjusted: shrunkWinRate(r.wins, r.games, 100),
      pick: r.games / stats.matches,
      ban: index.banRate(r.championId),
    }))
    .sort((a, b) => b.adjusted - a.adjusted);

  const selected = sp.campeao ? rows.find((r) => r.championId === sp.campeao) : undefined;
  const itemStats = selected ? await getItemStats(stats.patch, selected.championId, role) : null;

  return (
    <Shell>
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-gold text-3xl leading-none">Estatísticas</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            {formatMatches(stats.matches)} ranqueadas solo reais · patch {stats.patch}
          </p>
        </div>
        <p className="text-muted-foreground/70 max-w-sm text-[11px] leading-relaxed">
          Ordenado pela taxa corrigida pela amostra: 5 vitórias em 6 partidas não passa na frente de
          53% em mil. Linhas apagadas têm menos de {MIN_ROLE_GAMES} partidas.
        </p>
      </header>

      <nav className="grid grid-cols-5 gap-1.5">
        {ROLES.map((r) => (
          <Link
            key={r}
            href={`/estatisticas?rota=${r}`}
            className={cn(
              "rounded-sm border px-2 py-2 text-center text-xs font-medium transition-colors",
              r === role ? "border-gold/70 bg-gold/12 text-gold" : "border-border hover:border-gold/40 text-muted-foreground",
            )}
          >
            {ROLE_LABEL[r]}
          </Link>
        ))}
      </nav>

      {selected && (
        <ChampionDetail
          row={selected}
          role={role}
          stats={stats}
          matchupCatalog={matchupCatalog}
          itemStats={itemStats}
          items={new Map(payload.items.map((i) => [i.id, i]))}
        />
      )}

      <div className="panel-plain overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-muted-foreground border-b text-left text-[10px] tracking-wider uppercase">
              <th className="w-10 px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Campeão</th>
              <th className="px-3 py-2 font-medium">Vitória</th>
              <th className="px-3 py-2 text-right font-medium">Escolha</th>
              <th className="px-3 py-2 text-right font-medium">Banimento</th>
              <th className="px-3 py-2 text-right font-medium">Partidas</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const thin = r.games < MIN_ROLE_GAMES;
              return (
                <tr
                  key={r.championId}
                  className={cn(
                    "border-border/50 border-b last:border-0",
                    thin && "opacity-45",
                    r.championId === selected?.championId && "bg-gold/8",
                  )}
                >
                  <td className="text-muted-foreground px-3 py-1.5 font-mono text-xs tabular-nums">{i + 1}</td>
                  <td className="px-3 py-1.5">
                    <Link
                      href={`/estatisticas?rota=${role}&campeao=${r.championId}`}
                      className="hover:text-gold flex items-center gap-2"
                    >
                      <ChampIcon champion={r.champion} fallback={r.championId} size="size-7" />
                      <span>{r.champion?.name ?? r.championId}</span>
                    </Link>
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="w-12 font-mono text-xs tabular-nums">{formatRate(r.raw)}</span>
                      {/* régua de 40% a 60%: fora disso quase nada acontece */}
                      <span className="bg-background/70 relative hidden h-1.5 w-24 rounded-full sm:block">
                        <span className="bg-border-strong absolute inset-y-0 left-1/2 w-px" />
                        <span
                          className={cn(
                            "absolute inset-y-0 rounded-full",
                            r.adjusted >= 0.5 ? "bg-advantage left-1/2" : "bg-disadvantage right-1/2",
                          )}
                          style={{ width: `${Math.min(50, Math.abs(r.adjusted - 0.5) * 500)}%` }}
                        />
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs tabular-nums">{formatRate(r.pick)}</td>
                  <td className="text-muted-foreground px-3 py-1.5 text-right font-mono text-xs tabular-nums">
                    {formatRate(r.ban)}
                  </td>
                  <td className="text-muted-foreground px-3 py-1.5 text-right font-mono text-xs tabular-nums">
                    {formatGames(r.games)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}

function ChampionDetail({
  row,
  role,
  stats,
  matchupCatalog,
  itemStats,
  items,
}: {
  row: { championId: string; games: number; raw: number; champion?: ChampionRef };
  role: Role;
  stats: StatsPayload;
  matchupCatalog: ReturnType<typeof engineCatalogs>["matchupCatalog"];
  itemStats: Awaited<ReturnType<typeof getItemStats>> | null;
  items: Map<number, ItemRef>;
}) {
  const champions = matchupCatalog.champions;
  const matchups = stats.matchups
    .filter((m) => m.championId === row.championId && m.role === role && m.games >= MIN_MATCHUP_GAMES)
    .map((m) => {
      const rules = analyzeMatchup(
        { selfChampionId: m.championId, enemyChampionId: m.opponentId, allyJungleId: null, enemyJungleId: null },
        matchupCatalog,
      );
      const adjusted = shrunkWinRate(m.wins, m.games, 40);
      return { ...m, raw: m.wins / m.games, adjusted, rules: rules.score };
    })
    .sort((a, b) => b.adjusted - a.adjusted);

  // onde as regras e a prática discordam: a regra diz uma coisa, o placar outra
  const disagreements = matchups.filter(
    (m) => (m.rules >= 2 && m.adjusted < 0.47) || (m.rules <= -2 && m.adjusted > 0.53),
  );

  // item visto em 3 builds não informa nada; a mesma régua da tabela
  const topItems = (itemStats?.items ?? [])
    .filter((i) => items.get(i.itemId)?.isLegendary && i.games >= MIN_MATCHUP_GAMES)
    .sort((a, b) => b.games - a.games)
    .slice(0, 8);

  const list = (title: string, entries: typeof matchups) => (
    <div>
      <p className="text-muted-foreground mb-1.5 text-[10px] tracking-wider uppercase">{title}</p>
      {entries.length === 0 ? (
        <p className="text-muted-foreground text-[11px]">Amostra insuficiente.</p>
      ) : (
        <ul className="space-y-1">
          {entries.map((m) => (
            <li key={m.opponentId} className="flex items-center gap-2 text-xs">
              <ChampIcon champion={champions.get(m.opponentId)} fallback={m.opponentId} size="size-6" />
              <span className="min-w-0 flex-1 truncate">{champions.get(m.opponentId)?.name ?? m.opponentId}</span>
              <span className="font-mono tabular-nums">{formatRate(m.raw)}</span>
              <span className="text-muted-foreground w-10 text-right font-mono text-[10px] tabular-nums">
                {formatGames(m.games)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <section className="panel space-y-4 p-4">
      <div className="flex items-center gap-3">
        <ChampIcon champion={row.champion} fallback={row.championId} size="size-12" />
        <div>
          <p className="font-display text-xl">{row.champion?.name ?? row.championId}</p>
          <p className="text-muted-foreground text-xs">
            {ROLE_LABEL[role]} · {formatRate(row.raw)} de vitória em {formatMatches(row.games)}
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {list("Melhores confrontos", matchups.slice(0, 5))}
        {list("Piores confrontos", [...matchups].reverse().slice(0, 5))}
        <div>
          <p className="text-muted-foreground mb-1.5 flex text-[10px] tracking-wider uppercase">
            <span className="flex-1">Itens na build final</span>
            <span title="em quantas builds o item aparece">presença</span>
            <span className="w-12 text-right" title="vitória de quem terminou com o item">vitória</span>
          </p>
          {topItems.length === 0 ? (
            <p className="text-muted-foreground text-[11px]">Amostra insuficiente.</p>
          ) : (
            <ul className="space-y-1">
              {topItems.map((i) => {
                const item = items.get(i.itemId);
                return (
                  <li key={i.itemId} className="flex items-center gap-2 text-xs">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item?.iconUrl ?? ""} alt="" className="size-6 rounded-sm" />
                    <span className="min-w-0 flex-1 truncate">{item?.name}</span>
                    <span className="text-muted-foreground w-14 text-right font-mono text-[10px] tabular-nums">
                      {formatRate(i.games / (itemStats?.total || 1))}
                    </span>
                    <span className="w-12 text-right font-mono tabular-nums">{formatRate(i.wins / i.games)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {disagreements.length > 0 && (
        <div className="border-border-strong border-t pt-3">
          <p className="text-even text-[10px] font-semibold tracking-wider uppercase">
            Onde as regras e a prática discordam
          </p>
          <ul className="text-muted-foreground mt-1.5 space-y-1 text-[11px] leading-relaxed">
            {disagreements.slice(0, 4).map((m) => (
              <li key={m.opponentId}>
                Contra {champions.get(m.opponentId)?.name ?? m.opponentId}: as regras dão{" "}
                {m.rules > 0 ? "+" : ""}
                {m.rules}, mas na prática são {formatRate(m.raw)} em {formatGames(m.games)} partidas. Candidato
                a revisão manual em <code className="bg-muted rounded px-1">champion_matchup_overrides</code>.
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">{children}</main>;
}
