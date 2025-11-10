//import { Inter, Roboto_Mono } from "next/font/google";
import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/Header";


/*const inter = Inter({
    variable: "--font-geist-sans",
    subsets: ["latin"],
});

const robotoMono = Roboto_Mono({
    variable: "--font-geist-mono",
    subsets: ["latin"],
});

export const metadata = {
  title: "Liga Pokémon GO - Região Oceânica",
  description: "Sistema oficial da Liga Pokémon GO da Região Oceânica de Niterói",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body className="bg-slate-100 text-slate-900 min-h-screen">
        <Header />
        <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}*/

export const metadata: Metadata = {
  title: "Liga Pokémon GO - Região Oceânica",
  description: "Sistema oficial da Liga Pokémon GO da Região Oceânica de Niterói",
  openGraph: {
    title: "Liga Pokémon GO - Região Oceânica",
    description: "Sistema oficial da Liga Pokémon GO da Região Oceânica de Niterói",
    url: "https://seu-site.vercel.app",
    siteName: "Liga Pokémon GO - Região Oceânica",
    images: [
      {
        url: "https://seu-site.vercel.app/og-image.png",
        width: 1200,
        height: 630,
        alt: "Liga Pokémon GO - Região Oceânica",
      },
    ],
    type: "website",
  },
  icons: {
    icon: "/favicon.ico",        // ícone da aba
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
      <Header />
        <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
    </html>
  );
}