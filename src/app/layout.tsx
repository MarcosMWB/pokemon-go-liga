// src/app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import { Header } from "@/components/Header";

export const metadata: Metadata = {
  metadataBase: new URL("https://pokemon-go-liga.vercel.app"),
  title: "Liga Pokémon GO - Região Oceânica",
  description: "Sistema oficial da Liga Pokémon GO da Região Oceânica de Niterói",
  openGraph: {
    title: "Liga Pokémon GO - Região Oceânica",
    description: "Sistema oficial da Liga Pokémon GO da Região Oceânica de Niterói",
    url: "https://pokemon-go-liga.vercel.app/",
    siteName: "Liga Pokémon GO - Região Oceânica",
    images: [{ url: "https://pokemon-go-liga.vercel.app/logo.png", width: 1200, height: 630, alt: "Liga Pokémon GO - Região Oceânica" }],
    type: "website",
  },
  icons: { icon: "/favicon.ico", shortcut: "/favicon.ico", apple: "/apple-touch-icon.png" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="h-full">
      <body className="min-h-full text-foreground antialiased selection:bg-fuchsia-300/30 selection:text-fuchsia-900">
        <div className="relative min-h-full">
          <div className="fixed inset-0 -z-20 bg-[url('/bg-ro.webp')] bg-cover bg-center bg-fixed opacity-35" />
          {/* DECORAÇÕES DE FUNDO */}
          {/* Base gradient – cobre a página inteira */}
          <div aria-hidden className="absolute inset-0 -z-30 bg-gradient-to-br from-emerald-50 via-white to-cyan-50" />

          {/* Imagem (parallax). Pode remover se não quiser fixa ao viewport */}
          <div aria-hidden className="fixed inset-0 -z-40 bg-[url('/bg-ro.webp')] bg-cover bg-center bg-no-repeat opacity-35" />

          {/* Decorações que acompanham a altura da página */}
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-20 overflow-hidden">
            <div className="absolute left-[-20%] top-[-10%] h-[40rem] w-[40rem] rounded-full bg-gradient-to-br from-fuchsia-300/40 to-cyan-300/40 blur-3xl" />
            <div className="absolute right-[-10%] bottom-[-15%] h-[32rem] w-[32rem] rounded-full bg-gradient-to-tr from-violet-300/35 to-sky-300/35 blur-3xl" />
            <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(120,119,198,0.12)_1px,transparent_1px),linear-gradient(to_bottom,rgba(120,119,198,0.12)_1px,transparent_1px)] bg-[size:24px_24px] [mask-image:radial-gradient(900px_600px_at_30%_10%,black,transparent_70%)]" />
          </div>

          <Header />
          <main className="relative max-w-6xl mx-auto px-4 py-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
