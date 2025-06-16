// app/mapa/page.tsx
'use client'

import { useState } from 'react'
import Image from 'next/image'

const regioes = [
    {
        nome: "Cafubá",
        coordenadas: { top: "25%", left: "30%" },
        simbolo: "🌿",
        descricao: "Uma região de recomeços e resiliência, com batalhas estratégicas e espírito comunitário."
    },
    {
        nome: "Camboinhas",
        coordenadas: { top: "65%", left: "46%" },
        simbolo: "⚓",
        descricao: "A beira-mar, o ginásio representa estabilidade, coragem e domínio emocional."
    },
    {
        nome: "Engenho do Mato",
        coordenadas: { top: "8%", left: "95%" },
        simbolo: "🌾",
        descricao: "Área rural com forte ligação à natureza e resistência física."
    },
    {
        nome: "Itacoatiara",
        coordenadas: { top: "90%", left: "70%" },
        simbolo: "🏄",
        descricao: "Espírito esportivo e conexão com os elementos. Batalhas de alto risco e velocidade."
    },
    {
        nome: "Itaipu",
        coordenadas: { top: "81%", left: "66%" },
        simbolo: "🛶",
        descricao: "Uma área serena onde batalhas são táticas e meditativas."
    },
    {
        nome: "Jacaré",
        coordenadas: { top: "7%", left: "50%" },
        simbolo: "🦎",
        descricao: "Região de adaptação e mobilidade, com batalhas rápidas."
    },
    {
        nome: "Maravista",
        coordenadas: { top: "45%", left: "65%" },
        simbolo: "🌳",
        descricao: "Ambiente voltado para equilíbrio, evolução e suporte mútuo."
    },
    {
        nome: "Piratininga",
        coordenadas: { top: "55%", left: "19%" },
        simbolo: "🏘️",
        descricao: "Centro urbano e tecnológico, batalhas inteligentes e dinâmicas."
    },
    {
        nome: "Santo Antônio",
        coordenadas: { top: "20%", left: "58%" },
        simbolo: "🏔️",
        descricao: "Ginásio de alto nível, onde a visão e estratégia são testadas."
    },
    {
        nome: "Serra Grande",
        coordenadas: { top: "22%", left: "80%" },
        simbolo: "🏔️",
        descricao: "Região elevada com batalhas difíceis. Só os mais preparados vencem."
    },
    {
        nome: "Jardim Imbuí",
        coordenadas: { top: "38%", left: "7%" },
        simbolo: "🍈",
        descricao: "Região elevada com batalhas difíceis. Só os mais preparados vencem."
    }
]

export default function MapaPage() {
    const [regiaoAtiva, setRegiaoAtiva] = useState(null)

    return (
        <div className="relative w-full max-w-5xl mx-auto p-4">
            <h1 className="text-3xl font-bold text-center mb-4">Mapa da Liga - Região Oceânica</h1>

            <div className="relative">
                <Image
                    src="/mapa-regiao-oceanica.png"
                    alt="Mapa da Região Oceânica"
                    width={1000}
                    height={800}
                    className="w-full h-auto rounded-xl shadow-lg"
                />

                {regioes.map((regiao, i) => (
                    <button
                        key={i}
                        onClick={() => {
                            return setRegiaoAtiva(regiao)
                        }}
                        className="absolute bg-white/80 rounded-full p-1 text-sm hover:bg-yellow-200 shadow"
                        style={{
                            top: regiao.coordenadas.top,
                            left: regiao.coordenadas.left,
                            transform: 'translate(-50%, -50%)'
                        }}
                    >
                        {regiao.simbolo}
                    </button>
                ))}
            </div>

            {regiaoAtiva && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white p-6 rounded-xl max-w-md text-center relative shadow-xl">
                        <button
                            onClick={() => setRegiaoAtiva(null)}
                            className="absolute top-2 right-4 text-xl font-bold text-gray-500 hover:text-red-600"
                        >
                            ×
                        </button>
                        <h2 className="text-2xl font-bold mb-2">{regiaoAtiva.nome}</h2>
                        <div className="text-4xl mb-4">{regiaoAtiva.simbolo}</div>
                        <p>{regiaoAtiva.descricao}</p>
                    </div>
                </div>
            )}
        </div>
    )
}
