import type { Metadata } from "next";
import { Inter, Roboto_Mono } from "next/font/google";
import "./globals.css";
import "./globals.css";
import type { ReactNode } from "react";
import { Header } from "@/components/Header";


const inter = Inter({
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="bg-slate-50">
        <Header />
        <main className="min-h-screen">{children}</main>
      </body>
    </html>
  );
}