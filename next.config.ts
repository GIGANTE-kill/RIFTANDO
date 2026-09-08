import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // o PGlite carrega um .wasm em runtime — não pode passar pelo bundler
  serverExternalPackages: ["@electric-sql/pglite"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "raw.communitydragon.org" },
      { protocol: "https", hostname: "cdn.merakianalytics.com" },
      { protocol: "https", hostname: "ddragon.leagueoflegends.com" },
    ],
  },
};

export default nextConfig;
