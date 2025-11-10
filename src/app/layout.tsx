//import { Inter, Roboto_Mono } from "next/font/google";
import "./globals.css";
import "./globals.css";
import type { ReactNode } from "react";
import { Header } from "@/components/Header";


/*const inter = Inter({
    variable: "--font-geist-sans",
    subsets: ["latin"],
});

const robotoMono = Roboto_Mono({
    variable: "--font-geist-mono",
    subsets: ["latin"],
});*/


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
}