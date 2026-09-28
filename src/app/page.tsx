import { loadCatalog } from "@/db/queries/catalog";
import { DatabaseNotice } from "@/components/match-bits";
import { MatchAnalyzer } from "@/components/match-analyzer";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { payload: catalog, error } = await loadCatalog();

  if (error)
    return (
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <DatabaseNotice error={error} />
      </main>
    );

  if (!catalog) {
    return (
      <main className="mx-auto max-w-md px-5 py-20 text-center">
        <h1 className="font-display text-gold text-xl">Banco vazio</h1>
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
          Rode <code className="bg-muted rounded px-1">npm run sync</code>,{" "}
          <code className="bg-muted rounded px-1">npm run tags:derive</code> e{" "}
          <code className="bg-muted rounded px-1">npm run db:seed</code> antes de abrir esta tela.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-8">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="font-display text-gold text-3xl leading-none">Riftando</h1>
            <p className="text-muted-foreground mt-2 text-sm">
              Monte a partida e receba o próximo item e o próximo passo, minuto a minuto.
            </p>
          </div>
          <p className="text-muted-foreground/70 text-[11px]">
            Patch {catalog.patch} · {catalog.champions.length} campeões · {catalog.items.length}{" "}
            itens
          </p>
        </div>
        <div className="via-gold/50 mt-4 h-px bg-gradient-to-r from-transparent to-transparent" />
      </header>

      <MatchAnalyzer payload={catalog} />

      <footer className="text-muted-foreground/60 mt-12 text-center text-[11px]">
        Tudo é calculado no seu aparelho, por regras. Nenhuma inteligência artificial é consultada.
      </footer>
    </main>
  );
}
