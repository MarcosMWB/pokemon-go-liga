'use client'

import { useState } from 'react'
import Image from 'next/image'

type RegiaoInfo = {
    nome: string
    coordenadas: { top: string; left: string }
    imagem: string
    descricao: string
}

const regioes: RegiaoInfo[] = [
    {
        nome: "Cafubá",
        coordenadas: { top: "25%", left: "30%" },
        imagem: "/Insignia/cafuba.png",
        descricao: "Uma região de recomeços e resiliência, com batalhas estratégicas e espírito comunitário."
    },
    {
        nome: "Camboinhas",
        coordenadas: { top: "65%", left: "46%" },
        imagem: "/Insignia/camboinhas.png",
        descricao: "À beira-mar, o ginásio representa estabilidade, coragem e domínio emocional."
    },
    {
        nome: "Engenho do Mato",
        coordenadas: { top: "8%", left: "95%" },
        imagem: "/Insignia/engenhodomato.png",
        descricao: "Área rural com forte ligação à natureza e resistência física."
    },
    {
        nome: "Itacoatiara",
        coordenadas: { top: "90%", left: "70%" },
        imagem: "/Insignia/itacoatiara.png",
        descricao: "Espírito esportivo e conexão com os elementos. Batalhas de alto risco e velocidade."
    },
    {
        nome: "Itaipu",
        coordenadas: { top: "81%", left: "66%" },
        imagem: "/Insignia/itaipu.png",
        descricao: "Uma área serena onde batalhas são táticas e meditativas."
    },
    {
        nome: "Jacaré",
        coordenadas: { top: "7%", left: "50%" },
        imagem: "/Insignia/jacare.png",
        descricao: "Região de adaptação e mobilidade, com batalhas rápidas."
    },
    {
        nome: "Maravista",
        coordenadas: { top: "45%", left: "65%" },
        imagem: "/Insignia/maravista.png",
        descricao: "Ambiente voltado para equilíbrio, evolução e suporte mútuo."
    },
    {
        nome: "Piratininga",
        coordenadas: { top: "55%", left: "19%" },
        imagem: "/Insignia/piratininga.png",
        descricao: "Centro urbano e tecnológico, batalhas inteligentes e dinâmicas."
    },
    {
        nome: "Santo Antônio",
        coordenadas: { top: "20%", left: "58%" },
        imagem: "/Insignia/santoantonio.png",
        descricao: "Liga Oceânica, onde a visão e estratégia são testadas."
    },
    {
        nome: "Serra Grande",
        coordenadas: { top: "22%", left: "80%" },
        imagem: "/Insignia/serragrande.png",
        descricao: "Região elevada com batalhas difíceis. Só os mais preparados vencem."
    },
    {
        nome: "Jardim Imbuí",
        coordenadas: { top: "38%", left: "7%" },
        imagem: "/Insignia/jardimimbui.png", // Substitua se criar a imagem correta para o Imbuí
        descricao: "Área montanhosa misteriosa, conhecida por embates técnicos e grande preparo mental."
    }
]

export default function MapaPage() {
    const [regiaoAtiva, setRegiaoAtiva] = useState<RegiaoInfo | null>(null)

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
                        onClick={() => setRegiaoAtiva(regiao)}
                        className="absolute bg-white/80 rounded-full p-1 hover:bg-yellow-200 shadow"
                        style={{
                            top: regiao.coordenadas.top,
                            left: regiao.coordenadas.left,
                            transform: 'translate(-50%, -50%)'
                        }}
                    >
                        <Image
                            src={regiao.imagem}
                            alt={`Insígnia de ${regiao.nome}`}
                            width={40}
                            height={40}
                            className="rounded-full"
                        />
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
                        <Image
                            src={regiaoAtiva.imagem}
                            alt={`Insígnia de ${regiaoAtiva.nome}`}
                            width={80}
                            height={80}
                            className="mx-auto mb-4"
                        />
                        <p>{regiaoAtiva.descricao}</p>
                    </div>
                </div>
            )}
        </div>
    )
}
