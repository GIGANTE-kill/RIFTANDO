import type { Metadata, Viewport } from "next";
import { Marcellus, Inter } from "next/font/google";
import { SiteNav } from "@/components/site-nav";
import "./globals.css";

// Marcellus tem o ar de capitular romana das fontes do jogo, sem ser pesada.
const display = Marcellus({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Riftando — seu treinador de partida",
  description:
    "Monte a partida, veja contra quem você joga de verdade e receba o próximo item e o próximo passo a cada minuto.",
};

export const viewport: Viewport = {
  themeColor: "#0a1428",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={`${display.variable} ${sans.variable} min-h-dvh font-sans`}>
        <SiteNav />
        {children}
      </body>
    </html>
  );
}
