import type { Metadata } from "next";
import { Inter, Roboto_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
    variable: "--font-geist-sans",
    subsets: ["latin"],
});

const robotoMono = Roboto_Mono({
    variable: "--font-geist-mono",
    subsets: ["latin"],
});

export const metadata: Metadata = {
    title: "Liga Pokémon GO - Região Oceânica",
    description: "Sistema oficial da Liga Pokémon GO da Região Oceânica de Niterói",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="pt-BR">
            <body className={`${inter.variable} ${robotoMono.variable} antialiased bg-blue-50`}>
                {children}
            </body>
        </html>
    );
}