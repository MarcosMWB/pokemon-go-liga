// src/app/cadastro/page.tsx
'use client'

import Link from 'next/link'

export default function Cadastro() {
    return (
        <main className="min-h-screen flex flex-col items-center justify-center bg-yellow-100 p-8 text-center">
            <h1 className="text-3xl md:text-4xl font-bold text-yellow-800 mb-4">
                Cadastro de Jogador
            </h1>
            <p className="text-md md:text-lg text-yellow-900 mb-6">
                Em breve: formulário para registrar seu time de 6 Pokémon!
            </p>
            <Link href="/">
                <button className="bg-yellow-600 text-white px-4 py-2 rounded-xl shadow hover:bg-yellow-700 transition">
                    Voltar à Página Inicial
                </button>
            </Link>
        </main>
    )
}
