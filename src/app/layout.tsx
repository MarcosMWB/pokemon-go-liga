// src/app/layout.tsx
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Header } from "@/components/Header";
import ConsentBanner from "@/components/ConsentBanner";
import Script from "next/script";
import Link from "next/link";

export const metadata: Metadata = {
  metadataBase: new URL("https://pokemon-go-liga.vercel.app"),
  title: "Liga Pokémon GO - Região Oceânica",
  description: "Sistema oficial da Liga Pokémon GO da Região Oceânica de Niterói",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Liga Pokémon GO - Região Oceânica",
    description: "Sistema oficial da Liga Pokémon GO da Região Oceânica de Niterói",
    url: "https://pokemon-go-liga.vercel.app/",
    siteName: "Liga Pokémon GO - Região Oceânica",
    images: [{ url: "https://pokemon-go-liga.vercel.app/logo.png", width: 1200, height: 630, alt: "Liga Pokémon GO - Região Oceânica" }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Liga Pokémon GO - Região Oceânica",
    description: "Sistema oficial da Liga Pokémon GO da Região Oceânica de Niterói",
    images: ["https://pokemon-go-liga.vercel.app/logo.png"],
  },
  icons: { icon: "/favicon.ico", shortcut: "/favicon.ico", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="h-full" suppressHydrationWarning>
      <head>
        {/* Consent Mode v2 - default BEM CEDO */}
        <Script id="consent-default" strategy="beforeInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('consent', 'default', {
              'ad_storage': 'denied',
              'analytics_storage': 'denied',
              'ad_user_data': 'denied',
              'ad_personalization': 'denied',
              'functionality_storage': 'granted',
              'security_storage': 'granted'
            });
          `}
        </Script>

        {/* gtag.js (GA4) — necessário para o Consent Mode v2 ser lido pelos produtos Google */}
        {/* Troque G-XXXXXXXXXX pelo seu ID GA4 (ou use GTM se preferir) */}
        <Script
          id="gtag-lib"
          src="https://www.googletagmanager.com/gtag/js?id=G-67SF3YSPKF"
          strategy="afterInteractive"
        />
        <Script id="gtag-init" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-67SF3YSPKF', { anonymize_ip: true });
          `}
        </Script>
      </head>
      <body className="min-h-full text-foreground antialiased selection:bg-fuchsia-300/30 selection:text-fuchsia-900">
        <div className="relative min-h-full">
          {/* BG fixo (parallax) */}
          <div className="fixed inset-0 -z-20 bg-[url('/bg-ro.webp')] bg-cover bg-center bg-fixed opacity-35" />
          {/* Base gradient */}
          <div aria-hidden className="absolute inset-0 -z-30 bg-gradient-to-br from-emerald-50 via-white to-cyan-50" />
          {/* Imagem extra */}
          <div aria-hidden className="fixed inset-0 -z-40 bg-[url('/bg-ro.webp')] bg-cover bg-center bg-no-repeat opacity-35" />
          {/* Decorações */}
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-20 overflow-hidden">
            <div className="absolute left-[-20%] top-[-10%] h-[40rem] w-[40rem] rounded-full bg-gradient-to-br from-fuchsia-300/40 to-cyan-300/40 blur-3xl" />
            <div className="absolute right-[-10%] bottom-[-15%] h-[32rem] w-[32rem] rounded-full bg-gradient-to-tr from-violet-300/35 to-sky-300/35 blur-3xl" />
            <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(120,119,198,0.12)_1px,transparent_1px),linear-gradient(to_bottom,rgba(120,119,198,0.12)_1px,transparent_1px)] bg-[size:24px_24px] [mask-image:radial-gradient(900px_600px_at_30%_10%,black,transparent_70%)]" />
          </div>

          <a href="#conteudo-principal" className="skip-link">Pular para o conteúdo principal</a>
          <Header />
          <main id="conteudo-principal" tabIndex={-1} className="relative max-w-6xl mx-auto px-4 py-6 outline-none">{children}</main>
          <footer className="site-footer relative isolate mt-12 overflow-hidden px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-12 text-white sm:pt-16">
            <div aria-hidden="true" className="site-footer__glow site-footer__glow--one" />
            <div aria-hidden="true" className="site-footer__glow site-footer__glow--two" />
            <div className="relative z-10 mx-auto max-w-6xl">
              <div className="grid gap-10 border-b border-white/10 pb-10 md:grid-cols-[1.4fr_1fr_1fr_1fr] md:gap-8 md:pb-12">
                <div className="max-w-sm">
                  <Link href="/" className="site-footer__brand inline-flex min-h-12 items-center gap-3 rounded-xl focus-visible:outline-white">
                    <span aria-hidden="true" className="site-footer__emblem">
                      <svg viewBox="0 0 40 40" fill="none" className="h-7 w-7" role="img">
                        <circle cx="20" cy="20" r="15" stroke="currentColor" strokeWidth="3" />
                        <path d="M5.8 17h28.4" stroke="currentColor" strokeWidth="3" />
                        <circle cx="20" cy="20" r="4.5" fill="currentColor" />
                        <circle cx="20" cy="20" r="2" fill="#172033" />
                      </svg>
                    </span>
                    <span>
                      <span className="block text-base font-extrabold tracking-tight">Liga Oceânica</span>
                      <span className="block text-xs font-medium text-cyan-100/70">Pokémon GO · Niterói</span>
                    </span>
                  </Link>
                  <p className="mt-4 max-w-xs text-sm leading-6 text-slate-300">
                    Uma comunidade para jogar, se encontrar e celebrar cada conquista na Região Oceânica.
                  </p>
                  <Link href="/cadastro" className="site-footer__join mt-5 inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-sm font-bold">
                    Faça parte da liga <span aria-hidden="true">→</span>
                  </Link>
                </div>

                <nav aria-label="Explorar o site">
                  <h2 className="site-footer__heading">Explore</h2>
                  <ul className="site-footer__links">
                    <li><Link href="/mapa">Mapa da região</Link></li>
                    <li><Link href="/ginasios/visitante">Ginásios</Link></li>
                    <li><Link href="/loja">Loja da comunidade</Link></li>
                  </ul>
                </nav>

                <nav aria-label="Jogar e competir">
                  <h2 className="site-footer__heading">Jogue com a gente</h2>
                  <ul className="site-footer__links">
                    <li><Link href="/campeonato-ro">Campeonato regional</Link></li>
                    <li><Link href="/elite4/placar?liga=Great">Placar da Elite 4</Link></li>
                    <li><Link href="/tutorials?t=guia-iniciante">Tutoriais e regras</Link></li>
                  </ul>
                </nav>

                <nav aria-label="Ajuda e informações">
                  <h2 className="site-footer__heading">Ajuda</h2>
                  <ul className="site-footer__links">
                    <li><Link href="/tutorials?t=guia-iniciante">Como começar</Link></li>
                    <li><Link href="/privacidade">Privacidade</Link></li>
                  </ul>
                </nav>
              </div>

              <div className="flex flex-col gap-3 pt-5 text-xs leading-5 text-slate-400 sm:flex-row sm:items-center sm:justify-between">
                <p>Feito com carinho para quem joga na Região Oceânica.</p>
                <p>Pokémon GO é uma marca de seus respectivos proprietários.</p>
              </div>
            </div>
          </footer>

          {/* AdSense Auto Ads (deixa afterInteractive mesmo) */}
          <Script
            id="adsbygoogle-init"
            strategy="afterInteractive"
            src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-2608686864167308"
            crossOrigin="anonymous"
          />
        </div>

        {/* Banner de consentimento (aceitar/tirar consentimento) */}
        <ConsentBanner />
      </body>
    </html>
  );
}
