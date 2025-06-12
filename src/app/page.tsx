// src/app/page.tsx
'use client'

import Link from 'next/link'

export default function Home() {
    return (
        <main className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-blue-100 to-blue-300 p-8 text-center">
            <h1 className="text-4xl md:text-5xl font-bold text-blue-800 mb-4">
                Liga Pokémon GO - Região Oceânica
            </h1>
            <p className="text-lg md:text-xl text-blue-900 max-w-2xl mb-8">
                Participe da maior liga regional de Pokémon GO em Niterói!
                Cadastre seu time, desafie ginásios e conquiste as insígnias
                para disputar o torneio dos campeões!
            </p>
            <Link href="/cadastro">
                <button className="bg-blue-700 text-white px-6 py-3 rounded-xl shadow hover:bg-blue-800 transition">
                    Cadastrar Jogador
                </button>
            </Link>
        </main>
    )
