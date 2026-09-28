"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

const PLATFORMS: { id: string; label: string }[] = [
  { id: "br1", label: "BR" },
  { id: "la1", label: "LAN" },
  { id: "la2", label: "LAS" },
  { id: "na1", label: "NA" },
  { id: "euw1", label: "EUW" },
  { id: "eun1", label: "EUNE" },
  { id: "kr", label: "KR" },
  { id: "jp1", label: "JP" },
  { id: "oc1", label: "OCE" },
  { id: "tr1", label: "TR" },
];

const LINKS = [
  { href: "/", label: "Treinador" },
  { href: "/estatisticas", label: "Estatísticas" },
];

const PLATFORM_KEY = "riftando:servidor";

export function SiteNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState("br1");
  const [error, setError] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(PLATFORM_KEY);
      if (saved) setPlatform(saved);
    } catch {
      /* sem localStorage: fica o BR */
    }
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const [name, tag] = query.split("#").map((s) => s.trim());
    if (!name || !tag) {
      setError(true);
      return;
    }
    setError(false);
    try {
      localStorage.setItem(PLATFORM_KEY, platform);
    } catch {
      /* ignora */
    }
    router.push(`/jogador/${platform}/${encodeURIComponent(`${name}-${tag}`)}`);
  };

  return (
    <nav className="border-border/60 bg-background/70 sticky top-0 z-30 border-b backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 sm:px-6">
        <Link href="/" className="font-display text-gold text-lg leading-none">
          Riftando
        </Link>
        <div className="flex gap-1">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "rounded-sm px-2 py-1 text-xs transition-colors",
                pathname === l.href
                  ? "text-gold bg-gold/10"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {l.label}
            </Link>
          ))}
        </div>

        <form onSubmit={submit} className="ml-auto flex w-full min-w-0 gap-1.5 sm:w-auto">
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            aria-label="Servidor"
            className="border-input bg-surface h-8 rounded-sm border px-1.5 text-xs"
          >
            {PLATFORMS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <div className="relative min-w-0 flex-1 sm:w-56">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setError(false);
              }}
              placeholder="Nome#TAG"
              aria-label="Buscar jogador pelo Riot ID"
              aria-invalid={error}
              className={cn(
                "border-input bg-surface focus-visible:border-gold/60 h-8 w-full rounded-sm border pr-2 pl-7 text-xs outline-none",
                error && "border-disadvantage/70",
              )}
            />
          </div>
        </form>
        {error && (
          <p className="text-disadvantage w-full text-right text-[11px]">
            Use o Riot ID completo, com a tag: Nome#BR1
          </p>
        )}
      </div>
    </nav>
  );
}
