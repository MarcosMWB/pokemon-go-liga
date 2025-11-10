// src/app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import { Header } from "@/components/Header";

export const metadata: Metadata = {
  title: "Liga GO RO",
  description: "Liga regional de Pokémon GO",
  openGraph: {
    title: "Liga GO RO",
    description: "Liga regional de Pokémon GO",
    url: "https://seu-dominio.vercel.app", // troca pelo teu domínio
    siteName: "Liga GO RO",
    images: [
      {
        url: "https://seu-dominio.vercel.app/og-image.png", // coloca o caminho certo
        width: 1200,
        height: 630,
        alt: "Liga GO RO",
      },
    ],
    type: "website",
  },
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body className="bg-background text-foreground min-h-screen">
        <Header />
        <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
