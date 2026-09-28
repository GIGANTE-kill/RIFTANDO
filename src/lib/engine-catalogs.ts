import type { CatalogPayload } from "@/db/queries/catalog";
import type { Catalog } from "@/engine/itemization";
import type { MatchupCatalog } from "@/engine/matchup";
import { buildStatsIndex } from "@/engine/stats";

/** O payload do banco nos formatos que cada motor espera. */
export function engineCatalogs(payload: CatalogPayload): {
  catalog: Catalog;
  matchupCatalog: MatchupCatalog;
} {
  const champions = new Map(payload.champions.map((c) => [c.id, c]));
  return {
    catalog: { items: new Map(payload.items.map((i) => [i.id, i])), champions, rules: payload.rules },
    matchupCatalog: {
      champions,
      tagRules: payload.matchupRules,
      overrides: payload.matchupOverrides,
      stats: payload.stats ? buildStatsIndex(payload.stats) : undefined,
    },
  };
}
