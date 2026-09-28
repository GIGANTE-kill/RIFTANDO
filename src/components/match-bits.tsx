import type { DatabaseProblem } from "@/db/queries/catalog";
import type { ChampionRef, ItemRef } from "@/engine/types";
import { cn } from "@/lib/utils";

/** Pedaços visuais reaproveitados pelo perfil, pela revisão e pela estatística. */

export function ChampIcon({
  champion,
  fallback,
  size = "size-10",
  className,
}: {
  champion?: ChampionRef;
  fallback?: string;
  size?: string;
  className?: string;
}) {
  const name = champion?.name ?? fallback ?? "";
  if (!champion?.iconUrl)
    return (
      <span className={cn("portrait-empty text-muted-foreground text-[9px]", size, className)}>
        {name.slice(0, 3)}
      </span>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={champion.iconUrl} alt={name} title={name} className={cn("portrait", size, className)} />
  );
}

export function ItemIcons({
  ids,
  items,
  size = "size-7",
  slots = 6,
}: {
  ids: number[];
  items: Map<number, ItemRef>;
  size?: string;
  slots?: number;
}) {
  const filled = ids.slice(0, slots);
  return (
    <div className="flex gap-0.5">
      {filled.map((id, i) => {
        const item = items.get(id);
        return item?.iconUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={`${id}-${i}`} src={item.iconUrl} alt={item.name} title={item.name} className={cn("rounded-sm", size)} />
        ) : (
          <span key={`${id}-${i}`} className={cn("bg-surface-raised rounded-sm", size)} />
        );
      })}
      {Array.from({ length: Math.max(0, slots - filled.length) }).map((_, i) => (
        <span key={`empty-${i}`} className={cn("bg-background/60 rounded-sm", size)} />
      ))}
    </div>
  );
}

export const kda = (k: number, d: number, a: number) =>
  d === 0 ? "perfeito" : ((k + a) / d).toLocaleString("pt-BR", { maximumFractionDigits: 1 });

export const formatDuration = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function timeAgo(date: Date): string {
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 60) return `há ${Math.max(1, minutes)} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  return `há ${days} dia${days > 1 ? "s" : ""}`;
}

/** Aviso padrão para quando a chave da Riot falta ou foi recusada. */
export function RiotKeyNotice({ message }: { message?: string }) {
  return (
    <div className="panel mx-auto max-w-xl space-y-3 p-5 text-sm">
      <p className="font-display text-gold text-lg">Falta a chave da API da Riot</p>
      <p className="text-muted-foreground leading-relaxed">
        {message ??
          "Perfil, revisão pós-jogo e estatística usam a API oficial da Riot, que exige uma chave gratuita."}
      </p>
      <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-xs leading-relaxed">
        <li>
          Entre em <span className="text-foreground">developer.riotgames.com</span> com a sua conta
          do LoL e copie a <em>Development API Key</em>.
        </li>
        <li>
          Coloque no <code className="bg-muted rounded px-1">.env.local</code>:{" "}
          <code className="bg-muted rounded px-1">RIOT_API_KEY=RGAPI-…</code>
        </li>
        <li>Reinicie o <code className="bg-muted rounded px-1">npm run dev</code>.</li>
      </ol>
      <p className="text-muted-foreground/70 text-[11px]">
        A chave de desenvolvimento expira a cada 24 h. Para não precisar renovar, peça uma
        &ldquo;Personal API Key&rdquo; no mesmo site. Enquanto isso, a{" "}
        <a href="/partida/demo" className="text-gold underline underline-offset-2">
          revisão de demonstração
        </a>{" "}
        mostra como fica.
      </p>
    </div>
  );
}

/** O banco não respondeu — o que fazer, em vez de uma página de erro. */
export function DatabaseNotice({ error }: { error: DatabaseProblem }) {
  const populate = (
    <>
      <code className="bg-muted rounded px-1">npm run db:push</code>,{" "}
      <code className="bg-muted rounded px-1">sync</code>,{" "}
      <code className="bg-muted rounded px-1">tags:derive</code> e{" "}
      <code className="bg-muted rounded px-1">db:seed</code>
    </>
  );
  const content: Record<DatabaseProblem, { title: string; body: React.ReactNode }> = {
    NOT_CONFIGURED: {
      title: "Falta conectar o banco de dados",
      body: (
        <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-xs leading-relaxed">
          <li>
            No painel da Vercel: projeto &gt; <span className="text-foreground">Storage</span> &gt;
            Create Database &gt; <span className="text-foreground">Neon</span> (plano gratuito) e
            conecte ao projeto — isso cria a variável{" "}
            <code className="bg-muted rounded px-1">DATABASE_URL</code>.
          </li>
          <li>Popule o banco a partir do seu computador com essa URL: {populate}.</li>
          <li>Faça um novo deploy.</li>
        </ol>
      ),
    },
    NO_TABLES: {
      title: "O banco está conectado, mas vazio",
      body: (
        <p className="text-muted-foreground text-xs leading-relaxed">
          As tabelas ainda não foram criadas. Rode, com a DATABASE_URL deste deploy: {populate}.
        </p>
      ),
    },
    AUTH: {
      title: "O banco recusou a senha",
      body: (
        <p className="text-muted-foreground text-xs leading-relaxed">
          A DATABASE_URL está com usuário ou senha errados — copie de novo do painel do banco.
        </p>
      ),
    },
    UNREACHABLE: {
      title: "O banco não respondeu",
      body: (
        <p className="text-muted-foreground text-xs leading-relaxed">
          O servidor do banco não aceitou a conexão. Confira a DATABASE_URL e se o banco está ativo.
        </p>
      ),
    },
    UNKNOWN: {
      title: "O banco de dados deu erro",
      body: (
        <p className="text-muted-foreground text-xs leading-relaxed">
          O detalhe está no log do servidor (na Vercel: projeto &gt; Logs).
        </p>
      ),
    },
  };
  return (
    <div className="panel mx-auto max-w-xl space-y-3 p-5 text-sm">
      <p className="font-display text-gold text-lg">{content[error].title}</p>
      {content[error].body}
    </div>
  );
}
