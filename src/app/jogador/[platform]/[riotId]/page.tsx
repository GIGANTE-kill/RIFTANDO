import Link from "next/link";
import { notFound } from "next/navigation";
import { getCatalog } from "@/db/queries/catalog";
import { getRecentMatches, resolveAccount, roleOfParticipant, finalItems } from "@/db/queries/matches";
import {
  hasRiotKey,
  isPlatform,
  riotApi,
  PLATFORM_LABEL,
  RiotApiError,
} from "@/lib/riot/client";
import { ROLE_LABEL } from "@/engine/match";
import {
  ChampIcon,
  DatabaseNotice,
  ItemIcons,
  RiotKeyNotice,
  formatDuration,
  kda,
  timeAgo,
} from "@/components/match-bits";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const QUEUE_LABEL: Record<number, string> = {
  420: "Ranqueada solo",
  440: "Ranqueada flex",
  400: "Normal (escolha)",
  430: "Normal (às cegas)",
  450: "ARAM",
  490: "Partida rápida",
  1700: "Arena",
};

const TIER_LABEL: Record<string, string> = {
  IRON: "Ferro",
  BRONZE: "Bronze",
  SILVER: "Prata",
  GOLD: "Ouro",
  PLATINUM: "Platina",
  EMERALD: "Esmeralda",
  DIAMOND: "Diamante",
  MASTER: "Mestre",
  GRANDMASTER: "Grão-Mestre",
  CHALLENGER: "Desafiante",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ riotId: string }>;
}) {
  const { riotId } = await params;
  return { title: `${decodeURIComponent(riotId).replace(/-([^-]*)$/, "#$1")} — Riftando` };
}

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ platform: string; riotId: string }>;
}) {
  const { platform, riotId } = await params;
  if (!isPlatform(platform)) notFound();

  // "Nome-TAG": a tag nunca tem hífen, então o último separa
  const decoded = decodeURIComponent(riotId);
  const cut = decoded.lastIndexOf("-");
  const gameName = cut > 0 ? decoded.slice(0, cut) : decoded;
  const tagLine = cut > 0 ? decoded.slice(cut + 1) : PLATFORM_LABEL[platform];

  if (!hasRiotKey()) return <Shell><RiotKeyNotice /></Shell>;

  let data;
  try {
    const account = await resolveAccount(platform, gameName, tagLine);
    if (!account)
      return (
        <Shell>
          <div className="panel-plain mx-auto max-w-md p-6 text-center text-sm">
            <p className="font-display text-gold text-lg">Jogador não encontrado</p>
            <p className="text-muted-foreground mt-2">
              Nenhuma conta {gameName}#{tagLine} no servidor {PLATFORM_LABEL[platform]}. Confira a tag
              — ela aparece no cliente, ao lado do nome.
            </p>
          </div>
        </Shell>
      );
    const [entries, matches, catalog] = await Promise.all([
      riotApi.leagueEntries(platform, account.puuid),
      getRecentMatches(platform, account.puuid, 12),
      getCatalog(),
    ]);
    data = { account, entries: entries ?? [], matches, catalog };
  } catch (e) {
    if (e instanceof RiotApiError) return <Shell><RiotKeyNotice message={e.message} /></Shell>;
    // o que não é da Riot aqui é o banco (conta e partidas são gravadas nele)
    console.error("[riftando] perfil:", e);
    return (
      <Shell>
        <DatabaseNotice error={e instanceof Error ? e.message : String(e)} />
      </Shell>
    );
  }

  const { account, entries, matches, catalog } = data;
  const champions = new Map(catalog?.champions.map((c) => [c.id, c]) ?? []);
  const items = new Map(catalog?.items.map((i) => [i.id, i]) ?? []);

  const games = matches
    .map((m) => {
      const me = m.data.info.participants.find((p) => p.puuid === account.puuid);
      return me ? { row: m, me } : null;
    })
    .filter((g): g is NonNullable<typeof g> => Boolean(g));

  // resumo das partidas recentes
  const wins = games.filter((g) => g.me.win).length;
  const pool = new Map<string, { games: number; wins: number; k: number; d: number; a: number }>();
  for (const { me } of games) {
    const e = pool.get(me.championName) ?? { games: 0, wins: 0, k: 0, d: 0, a: 0 };
    e.games++;
    if (me.win) e.wins++;
    e.k += me.kills;
    e.d += me.deaths;
    e.a += me.assists;
    pool.set(me.championName, e);
  }
  const topPool = [...pool].sort((a, b) => b[1].games - a[1].games).slice(0, 4);
  const roles = new Map<string, number>();
  for (const { me } of games) {
    const r = roleOfParticipant(me);
    if (r) roles.set(r, (roles.get(r) ?? 0) + 1);
  }
  const mainRole = [...roles].sort((a, b) => b[1] - a[1])[0]?.[0] as keyof typeof ROLE_LABEL | undefined;
  const avgDeaths = games.length ? games.reduce((s, g) => s + g.me.deaths, 0) / games.length : 0;

  const solo = entries.find((e) => e.queueType === "RANKED_SOLO_5x5");
  const flex = entries.find((e) => e.queueType === "RANKED_FLEX_SR");

  return (
    <Shell>
      <header className="flex flex-wrap items-center gap-4">
        {account.profileIconId !== null && catalog && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`https://ddragon.leagueoflegends.com/cdn/${catalog.patch}/img/profileicon/${account.profileIconId}.png`}
            alt=""
            className="portrait size-16"
          />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl leading-tight">
            {account.gameName}
            <span className="text-muted-foreground">#{account.tagLine}</span>
          </h1>
          <p className="text-muted-foreground text-xs">
            {PLATFORM_LABEL[platform]} · nível {account.summonerLevel ?? "?"}
          </p>
        </div>
        <div className="flex gap-2">
          {[
            { label: "Solo/Duo", entry: solo },
            { label: "Flex", entry: flex },
          ].map(({ label, entry }) => (
            <div key={label} className="panel-plain min-w-32 px-3 py-2">
              <p className="text-muted-foreground text-[10px] tracking-wider uppercase">{label}</p>
              {entry ? (
                <>
                  <p className="text-gold text-sm font-medium">
                    {TIER_LABEL[entry.tier] ?? entry.tier} {["MASTER", "GRANDMASTER", "CHALLENGER"].includes(entry.tier) ? "" : entry.rank}
                  </p>
                  <p className="text-muted-foreground text-[11px]">
                    {entry.leaguePoints} PDL · {entry.wins}V {entry.losses}D
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground text-sm">Sem ranque</p>
              )}
            </div>
          ))}
        </div>
      </header>

      {games.length > 0 && (
        <section className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
          <div className="panel p-4">
            <p className="text-muted-foreground text-[10px] tracking-wider uppercase">
              Últimas {games.length} partidas
            </p>
            <p className="font-display mt-1 text-3xl">
              {Math.round((wins / games.length) * 100)}%
            </p>
            <p className="text-muted-foreground text-xs">
              {wins} vitórias · {games.length - wins} derrotas
              {mainRole ? ` · joga mais de ${ROLE_LABEL[mainRole].toLowerCase()}` : ""}
            </p>
            <p className="text-muted-foreground mt-3 text-[11px] leading-relaxed">
              {avgDeaths >= 6
                ? `Média de ${avgDeaths.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mortes por partida — revise as derrotas para ver se elas se repetem no mesmo padrão.`
                : `Média de ${avgDeaths.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mortes por partida.`}
            </p>
          </div>
          <div className="panel-plain p-4">
            <p className="text-muted-foreground mb-2 text-[10px] tracking-wider uppercase">
              Campeões recentes
            </p>
            <ul className="space-y-2">
              {topPool.map(([id, s]) => (
                <li key={id} className="flex items-center gap-2.5">
                  <ChampIcon champion={champions.get(id)} fallback={id} size="size-8" />
                  <span className="min-w-0 flex-1 truncate text-sm">{champions.get(id)?.name ?? id}</span>
                  <span className="text-muted-foreground text-[11px] tabular-nums">
                    {s.games} {s.games === 1 ? "partida" : "partidas"}
                  </span>
                  <span className="w-10 text-right text-[11px] tabular-nums">
                    {Math.round((s.wins / s.games) * 100)}%
                  </span>
                  <span className="text-muted-foreground w-16 text-right text-[11px] tabular-nums">
                    {kda(s.k, s.d, s.a)} KDA
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="rule-heading">Partidas</h2>
        {games.length === 0 && (
          <p className="panel-plain text-muted-foreground p-6 text-center text-sm">
            Nenhuma partida recente encontrada.
          </p>
        )}
        <ul className="space-y-1.5">
          {games.map(({ row, me }) => {
            const role = roleOfParticipant(me);
            const minutes = row.durationSec / 60;
            const cs = me.totalMinionsKilled + me.neutralMinionsKilled;
            const reviewable = row.durationSec > 5 * 60 && [420, 440, 400, 430, 490].includes(row.queueId);
            return (
              <li
                key={row.id}
                className={cn(
                  "panel-plain flex flex-wrap items-center gap-x-4 gap-y-2 border-l-4 p-2.5",
                  me.win ? "border-l-advantage" : "border-l-disadvantage",
                )}
              >
                <div className="w-24 shrink-0">
                  <p className={cn("text-xs font-semibold", me.win ? "text-advantage" : "text-disadvantage")}>
                    {me.win ? "Vitória" : "Derrota"}
                  </p>
                  <p className="text-muted-foreground text-[10px]">{QUEUE_LABEL[row.queueId] ?? `Fila ${row.queueId}`}</p>
                  <p className="text-muted-foreground text-[10px]">
                    {formatDuration(row.durationSec)} · {timeAgo(row.startedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <ChampIcon champion={champions.get(me.championName)} fallback={me.championName} size="size-11" />
                  <div className="w-24">
                    <p className="truncate text-sm font-medium">{champions.get(me.championName)?.name ?? me.championName}</p>
                    <p className="text-muted-foreground text-[10px]">{role ? ROLE_LABEL[role] : "—"}</p>
                  </div>
                </div>
                <div className="w-24 text-center">
                  <p className="font-mono text-sm tabular-nums">
                    {me.kills}/<span className="text-disadvantage">{me.deaths}</span>/{me.assists}
                  </p>
                  <p className="text-muted-foreground text-[10px]">{kda(me.kills, me.deaths, me.assists)} KDA</p>
                </div>
                <div className="w-20 text-center">
                  <p className="font-mono text-xs tabular-nums">{cs} CS</p>
                  <p className="text-muted-foreground text-[10px]">
                    {(cs / minutes).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}/min
                  </p>
                </div>
                <ItemIcons ids={finalItems(me)} items={items} size="size-7" />
                {reviewable && (
                  <Link
                    href={`/partida/${row.id}?puuid=${encodeURIComponent(account.puuid)}`}
                    className="border-gold/60 text-gold hover:bg-gold/10 ml-auto rounded-sm border px-2.5 py-1 text-[11px] font-medium"
                  >
                    Revisar →
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">{children}</main>;
}
