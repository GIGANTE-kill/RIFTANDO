import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // o PGlite carrega um .wasm em runtime — não pode passar pelo bundler
  serverExternalPackages: ["@electric-sql/pglite"],
  // a revisão de demonstração lê a partida gravada em tempo de execução; sem
  // isso o deploy serverless não leva os JSONs junto com a função
  outputFileTracingIncludes: {
    "/partida/[matchId]": ["./scripts/fixtures/match-v5.json", "./scripts/fixtures/timeline-v5.json"],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "raw.communitydragon.org" },
      { protocol: "https", hostname: "cdn.merakianalytics.com" },
      { protocol: "https", hostname: "ddragon.leagueoflegends.com" },
    ],
  },
};

export default nextConfig;
