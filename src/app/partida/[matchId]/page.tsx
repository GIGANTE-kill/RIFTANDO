import { readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { loadCatalog } from "@/db/queries/catalog";
import { getMatch } from "@/db/queries/matches";
import { hasRiotKey, RiotApiError } from "@/lib/riot/client";
import type { MatchDto, TimelineDto } from "@/lib/riot/types";
import { buildReview, type DeathKind, type Review, type ReviewPlayer } from "@/engine/review";
import { verdictLabel } from "@/engine/matchup";
import { ROLE_LABEL } from "@/engine/match";
import { engineCatalogs } from "@/lib/engine-catalogs";
import { GoldChart } from "@/components/gold-chart";
import {
  ChampIcon,
  DatabaseNotice,
  ItemIcons,
  RiotKeyNotice,
  formatDuration,
  kda,
} from "@/components/match-bits";
import type { ItemRef } from "@/engine/types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Revisão da partida — Riftando" };

/** Partida sintética em scripts/fixtures: mostra a revisão sem chave da Riot. */
const DEMO_ID = "demo";
const DEMO_PUUID = "puuid-3";

async function loadMatch(matchId: string) {
  if (matchId === DEMO_ID) {
    const dir = path.join(process.cwd(), "scripts", "fixtures");
    const [match, timeline] = await Promise.all([
      readFile(path.join(dir, "match-v5.json"), "utf8"),
      readFile(path.join(dir, "timeline-v5.json"), "utf8"),
    ]);
    return { match: JSON.parse(match) as MatchDto, timeline: JSON.parse(timeline) as TimelineDto };
  }
  const row = await getMatch(matchId, { withTimeline: true });
  if (!row) return null;
  return { match: row.data, timeline: row.timeline };
}

const DEATH_LABEL: Record<DeathKind, string> = {
  GANK: "Gank",
  DUELO: "1 contra 1",
  ISOLADO: "Sozinho",
  DESVANTAGEM: "Em desvantagem",
  LUTA: "Luta de equipe",
  ESTRUTURA: "Torre/tropa",
};

export default async function MatchReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ matchId: string }>;
  searchParams: Promise<{ puuid?: string }>;
}) {
  const { matchId } = await params;
  const isDemo = matchId === DEMO_ID;
  const puuid = (await searchParams).puuid ?? (isDemo ? DEMO_PUUID : undefined);

  if (!isDemo && !hasRiotKey()) return <Shell><RiotKeyNotice /></Shell>;

  let loaded;
  try {
    loaded = await loadMatch(matchId);
  } catch (e) {
    if (e instanceof RiotApiError) return <Shell><RiotKeyNotice message={e.message} /></Shell>;
    throw e;
  }
  const { payload, error } = await loadCatalog();
  if (error) return <Shell><DatabaseNotice error={error} /></Shell>;

  if (!loaded || !payload)
    return (
      <Shell>
        <p className="panel-plain text-muted-foreground p-6 text-center text-sm">
          {payload ? `Partida ${matchId} não encontrada na API da Riot.` : "Banco vazio: rode npm run sync."}
        </p>
      </Shell>
    );

  const { catalog, matchupCatalog } = engineCatalogs(payload);
  const { match, timeline } = loaded;
  const review =
    puuid && timeline ? buildReview({ match, timeline, puuid, catalog, matchupCatalog }) : null;

  return (
    <Shell>
      {isDemo && (
        <p className="border-even/40 bg-even/10 text-even rounded-sm border px-3 py-2 text-[11px]">
          Partida de demonstração, montada à mão para mostrar a revisão. Com a chave da Riot
          configurada, o botão &ldquo;Revisar&rdquo; do seu perfil abre esta tela com as suas partidas.
        </p>
      )}
      {review ? (
        <ReviewView review={review} items={catalog.items} />
      ) : (
        <p className="panel-plain text-muted-foreground p-4 text-sm">
          {timeline
            ? "Escolha de quem é a perspectiva da revisão:"
            : "A Riot não devolveu a linha do tempo desta partida, então só dá para ver o placar."}
        </p>
      )}
      <Scoreboard
        match={match}
        champions={catalog.champions}
        items={catalog.items}
        matchId={matchId}
        selected={puuid}
        canReview={Boolean(timeline)}
      />
    </Shell>
  );
}

function ReviewView({ review, items }: { review: Review; items: Map<number, ItemRef> }) {
  const { me, lane } = review;

  return (
    <>
      <header className="flex flex-wrap items-center gap-4">
        <ChampIcon champion={me.champion} fallback={me.championName} size="size-16" />
        <div className="min-w-[12rem] flex-1">
          <p className={cn("text-xs font-semibold tracking-wider uppercase", me.win ? "text-advantage" : "text-disadvantage")}>
            {me.win ? "Vitória" : "Derrota"} · {formatDuration(review.durationMin * 60)}
          </p>
          <h1 className="font-display text-2xl leading-tight">
            {me.championName}
            {me.role && <span className="text-muted-foreground"> · {ROLE_LABEL[me.role]}</span>}
          </h1>
          <p className="text-muted-foreground text-xs">
            {me.name} · {me.kills}/{me.deaths}/{me.assists} ({kda(me.kills, me.deaths, me.assists)} KDA) ·{" "}
            {me.cs} CS ({(me.cs / review.durationMin).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}/min)
          </p>
        </div>
        <ItemIcons ids={me.items} items={items} size="size-9" />
      </header>

      {/* o que levar desta partida — a resposta que o placar não dá */}
      <section className="space-y-2">
        <h2 className="rule-heading">O que levar desta partida</h2>
        <ol className="grid gap-3 md:grid-cols-3 [&>*]:min-w-0">
          {review.lessons.map((l, i) => (
            <li key={i} className={cn("p-4", i === 0 ? "panel" : "panel-plain")}>
              <p className="text-gold-dim text-[10px] font-semibold tracking-wider uppercase">
                {i + 1}ª lição
              </p>
              <p className="mt-1 text-sm font-medium">{l.title}</p>
              <p className="text-muted-foreground mt-1.5 text-[11px] leading-relaxed">{l.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-3 md:grid-cols-[1fr_1.6fr] [&>*]:min-w-0">
        <div className="panel-plain space-y-3 p-4">
          <p className="text-muted-foreground text-[10px] tracking-wider uppercase">A rota</p>
          {lane.opponent ? (
            <>
              <div className="flex items-center gap-2">
                <ChampIcon champion={me.champion} size="size-9" />
                <span className="text-muted-foreground text-xs">contra</span>
                <ChampIcon champion={lane.opponent.champion} fallback={lane.opponent.championName} size="size-9" />
                <div className="ml-1">
                  <p className="text-xs">Previsto: {verdictLabel(lane.expected.verdict).toLowerCase()}</p>
                  <p className="text-muted-foreground text-[10px]">
                    placar das regras {lane.expected.score > 0 ? "+" : ""}
                    {lane.expected.score}
                  </p>
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-center">
                <Diff label="Ouro aos 10" value={lane.goldDiff10} />
                <Diff label="Ouro aos 14" value={lane.goldDiff14} />
                <Diff label="CS aos 10" value={lane.csDiff10} />
                <Diff label="CS aos 14" value={lane.csDiff14} />
              </dl>
            </>
          ) : null}
          <p className="text-muted-foreground text-[11px] leading-relaxed">{lane.text}</p>
        </div>

        <div className="panel-plain p-4">
          <p className="text-muted-foreground mb-2 text-[10px] tracking-wider uppercase">
            Diferença de ouro do seu time, minuto a minuto
          </p>
          <GoldChart
            points={review.teamGold}
            marks={review.deaths.map((d) => ({
              minute: d.minute,
              label: `Você morreu aos ${d.minute}:${String(d.second).padStart(2, "0")}`,
            }))}
          />
          <p className="text-muted-foreground/70 mt-1 text-[10px]">Traços na base: suas mortes.</p>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 [&>*]:min-w-0">
        <div className="space-y-2">
          <h2 className="rule-heading">Suas compras</h2>
          {review.purchases.length === 0 ? (
            <p className="panel-plain text-muted-foreground p-4 text-xs">Nenhum item lendário completo.</p>
          ) : (
            <ul className="space-y-1.5">
              {review.purchases.map((p, i) => (
                <li key={i} className="panel-plain flex gap-3 p-3">
                  <span className="text-muted-foreground w-7 shrink-0 pt-1 font-mono text-xs tabular-nums">
                    {p.minute}&apos;
                  </span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.item.iconUrl ?? ""} alt="" className="portrait size-9 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <span className="font-medium">{p.item.name}</span>
                      <VerdictChip verdict={p.verdict} />
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-[11px] leading-relaxed">{p.note}</p>
                    {p.verdict === "DIVERGIU" && (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <span className="text-muted-foreground text-[10px]">O motor sugeria:</span>
                        {p.recommended.map((r) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={r.item.id} src={r.item.iconUrl ?? ""} alt={r.item.name} title={r.item.name} className="size-6 rounded-sm" />
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2">
          <h2 className="rule-heading">Suas mortes</h2>
          {review.deaths.length === 0 ? (
            <p className="panel-plain text-muted-foreground p-4 text-xs">Nenhuma morte. Partida limpa.</p>
          ) : (
            <ul className="space-y-1.5">
              {review.deaths.map((d, i) => (
                <li key={i} className="panel-plain flex gap-3 p-3">
                  <span className="text-muted-foreground w-9 shrink-0 pt-0.5 font-mono text-xs tabular-nums">
                    {d.minute}:{String(d.second).padStart(2, "0")}
                  </span>
                  {d.killer ? (
                    <ChampIcon champion={d.killer.champion} fallback={d.killer.championName} size="size-8" className="shrink-0" />
                  ) : (
                    <span className="portrait-empty size-8 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium">{DEATH_LABEL[d.kind]}</p>
                    <p className="text-muted-foreground mt-0.5 text-[11px] leading-relaxed">{d.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}

function Diff({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="bg-background/50 rounded-sm px-2 py-1.5">
      <dt className="text-muted-foreground text-[10px]">{label}</dt>
      <dd
        className={cn(
          "font-mono text-sm tabular-nums",
          value === null ? "text-muted-foreground" : value > 0 ? "text-advantage" : value < 0 ? "text-disadvantage" : "",
        )}
      >
        {value === null ? "—" : `${value > 0 ? "+" : ""}${value.toLocaleString("pt-BR")}`}
      </dd>
    </div>
  );
}

function VerdictChip({ verdict }: { verdict: "ALINHADO" | "LIVRE" | "DIVERGIU" }) {
  const style = {
    ALINHADO: "bg-advantage/15 text-advantage",
    LIVRE: "bg-muted text-muted-foreground",
    DIVERGIU: "bg-disadvantage/15 text-disadvantage",
  }[verdict];
  const label = { ALINHADO: "✓ certo para a partida", LIVRE: "escolha livre", DIVERGIU: "✗ a partida pedia outro" }[verdict];
  return <span className={cn("rounded-sm px-1.5 py-0.5 text-[10px] font-medium", style)}>{label}</span>;
}

function Scoreboard({
  match,
  champions,
  items,
  matchId,
  selected,
  canReview,
}: {
  match: MatchDto;
  champions: Map<string, NonNullable<ReviewPlayer["champion"]>>;
  items: Map<number, ItemRef>;
  matchId: string;
  selected?: string;
  canReview: boolean;
}) {
  const teams = [100, 200] as const;
  return (
    <section className="space-y-2">
      <h2 className="rule-heading">Placar</h2>
      <div className="grid gap-3 lg:grid-cols-2 [&>*]:min-w-0">
        {teams.map((teamId) => {
          const players = match.info.participants.filter((p) => p.teamId === teamId);
          const won = players[0]?.win;
          return (
            <div key={teamId} className="panel-plain p-3">
              <p className={cn("mb-2 text-[10px] font-semibold tracking-wider uppercase", won ? "text-advantage" : "text-disadvantage")}>
                {teamId === 100 ? "Time azul" : "Time vermelho"} · {won ? "vitória" : "derrota"}
              </p>
              <ul className="space-y-1">
                {players.map((p) => (
                  <li
                    key={p.puuid}
                    className={cn(
                      "flex items-center gap-2 rounded-sm px-1.5 py-1",
                      p.puuid === selected && "bg-gold/10",
                    )}
                  >
                    <ChampIcon champion={champions.get(p.championName)} fallback={p.championName} size="size-7" />
                    <span className="min-w-0 flex-1 truncate text-[11px]">
                      {p.riotIdGameName ?? p.championName}
                    </span>
                    <span className="w-16 text-right font-mono text-[11px] tabular-nums">
                      {p.kills}/{p.deaths}/{p.assists}
                    </span>
                    <span className="hidden sm:block">
                      <ItemIcons
                        ids={[p.item0, p.item1, p.item2, p.item3, p.item4, p.item5].filter((i) => i > 0)}
                        items={items}
                        size="size-5"
                      />
                    </span>
                    {canReview && p.puuid !== selected && (
                      <Link
                        href={`/partida/${matchId}?puuid=${encodeURIComponent(p.puuid)}`}
                        className="text-muted-foreground hover:text-gold text-[10px] underline underline-offset-2"
                        title="Ver a revisão pela perspectiva deste jogador"
                      >
                        revisar
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">{children}</main>;
}
