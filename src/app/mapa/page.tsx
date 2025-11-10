"use client";

import { useState } from "react";
import Image from "next/image";
import { db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
} from "firebase/firestore";

type RegiaoInfo = {
  nome: string;
  coordenadas: { top: string; left: string };
  imagem: string;
  descricao: string;
};

const regioes: RegiaoInfo[] = [
  {
    nome: "Cafubá",
    coordenadas: { top: "25%", left: "30%" },
    imagem: "/Insignia/cafuba.png",
    descricao:
      "Uma região de recomeços e resiliência, com batalhas estratégicas e espírito comunitário.",
  },
  {
    nome: "Camboinhas",
    coordenadas: { top: "65%", left: "46%" },
    imagem: "/Insignia/camboinhas.png",
    descricao:
      "À beira-mar, o ginásio representa estabilidade, coragem e domínio emocional.",
  },
  {
    nome: "Engenho do Mato",
    coordenadas: { top: "8%", left: "95%" },
    imagem: "/Insignia/engenhodomato.png",
    descricao: "Área rural com forte ligação à natureza e resistência física.",
  },
  {
    nome: "Itacoatiara",
    coordenadas: { top: "90%", left: "70%" },
    imagem: "/Insignia/itacoatiara.png",
    descricao:
      "Espírito esportivo e conexão com os elementos. Batalhas de alto risco e velocidade.",
  },
  {
    nome: "Itaipu",
    coordenadas: { top: "81%", left: "66%" },
    imagem: "/Insignia/itaipu.png",
    descricao: "Uma área serena onde batalhas são táticas e meditativas.",
  },
  {
    nome: "Jacaré",
    coordenadas: { top: "7%", left: "50%" },
    imagem: "/Insignia/jacare.png",
    descricao: "Região de adaptação e mobilidade, com batalhas rápidas.",
  },
  {
    nome: "Maravista",
    coordenadas: { top: "45%", left: "65%" },
    imagem: "/Insignia/maravista.png",
    descricao: "Ambiente voltado para equilíbrio, evolução e suporte mútuo.",
  },
  {
    nome: "Piratininga",
    coordenadas: { top: "55%", left: "19%" },
    imagem: "/Insignia/piratininga.png",
    descricao: "Centro urbano e tecnológico, batalhas inteligentes e dinâmicas.",
  },
  {
    nome: "Santo Antônio",
    coordenadas: { top: "20%", left: "58%" },
    imagem: "/Insignia/santoantonio.png",
    descricao: "Liga Oceânica, onde a visão e estratégia são testadas.",
  },
  {
    nome: "Serra Grande",
    coordenadas: { top: "22%", left: "80%" },
    imagem: "/Insignia/serragrande.png",
    descricao:
      "Região elevada com batalhas difíceis. Só os mais preparados vencem.",
  },
  {
    nome: "Jardim Imbuí",
    coordenadas: { top: "38%", left: "7%" },
    imagem: "/Insignia/jardimimbui.png",
    descricao:
      "Área montanhosa misteriosa, conhecida por embates técnicos e grande preparo mental.",
  },
];

// mapa tipo -> ícone
const TYPE_ICONS: Record<string, string> = {
  normal: "/Type/48px-Normal_icon_SwSh.png",
  fire: "/Type/48px-Fire_icon_SwSh.png",
  water: "/Type/48px-Water_icon_SwSh.png",
  grass: "/Type/48px-Grass_icon_SwSh.png",
  electric: "/Type/48px-Electric_icon_SwSh.png",
  ice: "/Type/48px-Ice_icon_SwSh.png",
  fighting: "/Type/48px-Fighting_icon_SwSh.png",
  poison: "/Type/48px-Poison_icon_SwSh.png",
  ground: "/Type/48px-Ground_icon_SwSh.png",
  flying: "/Type/48px-Flying_icon_SwSh.png",
  psychic: "/Type/48px-Psychic_icon_SwSh.png",
  bug: "/Type/48px-Bug_icon_SwSh.png",
  rock: "/Type/48px-Rock_icon_SwSh.png",
  ghost: "/Type/48px-Ghost_icon_SwSh.png",
  dragon: "/Type/48px-Dragon_icon_SwSh.png",
  dark: "/Type/48px-Dark_icon_SwSh.png",
  steel: "/Type/48px-Steel_icon_SwSh.png",
  fairy: "/Type/48px-Fairy_icon_SwSh.png",
};

type GinasioExtra = {
  tipo?: string;
  liderNome?: string;
  em_disputa?: boolean;
};

export default function MapaPage() {
  const [regiaoAtiva, setRegiaoAtiva] = useState<RegiaoInfo | null>(null);
  const [ginasioInfo, setGinasioInfo] = useState<GinasioExtra | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);

  const handleAbrirRegiao = async (regiao: RegiaoInfo) => {
    setRegiaoAtiva(regiao);
    setGinasioInfo(null);
    setLoadingInfo(true);

    try {
      const q = query(
        collection(db, "ginasios"),
        where("nome", "==", regiao.nome)
      );
      const snap = await getDocs(q);

      if (snap.empty) {
        setGinasioInfo({
          tipo: undefined,
          liderNome: undefined,
          em_disputa: false,
        });
        setLoadingInfo(false);
        return;
      }

      const gDoc = snap.docs[0];
      const gData = gDoc.data() as any;

      let liderNome: string | undefined = undefined;
      if (gData.lider_uid) {
        const uSnap = await getDoc(doc(db, "usuarios", gData.lider_uid));
        if (uSnap.exists()) {
          const uData = uSnap.data() as any;
          liderNome = uData.nome || uData.email || gData.lider_uid;
        }
      }

      setGinasioInfo({
        tipo: gData.tipo || undefined,
        liderNome,
        em_disputa: gData.em_disputa === true,
      });
    } catch (err) {
      console.error(err);
      setGinasioInfo(null);
    } finally {
      setLoadingInfo(false);
    }
  };

  return (
    <div className="relative w-full max-w-5xl mx-auto p-4">
      <h1 className="text-3xl font-bold text-center mb-4">
        Mapa da Liga - Região Oceânica
      </h1>

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
            onClick={() => handleAbrirRegiao(regiao)}
            className="absolute bg-white/80 rounded-full p-1 hover:bg-yellow-200 shadow"
            style={{
              top: regiao.coordenadas.top,
              left: regiao.coordenadas.left,
              transform: "translate(-50%, -50%)",
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
          <div className="bg-white p-6 rounded-xl max-w-md text-center relative shadow-xl w-[90%] max-w-lg">
            <button
              onClick={() => {
                setRegiaoAtiva(null);
                setGinasioInfo(null);
              }}
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
            <p className="mb-4">{regiaoAtiva.descricao}</p>

            {loadingInfo && <p>carregando informações do ginásio...</p>}

            {!loadingInfo && ginasioInfo && (
              <div className="mt-3 text-left bg-slate-50 rounded p-3 text-sm space-y-2">
                <p className="flex items-center gap-2">
                  <span className="font-semibold">Tipo:</span>
                  {ginasioInfo.tipo ? (
                    TYPE_ICONS[ginasioInfo.tipo] ? (
                      <Image
                        src={TYPE_ICONS[ginasioInfo.tipo]}
                        alt={ginasioInfo.tipo}
                        width={32}
                        height={32}
                      />
                    ) : (
                      ginasioInfo.tipo
                    )
                  ) : (
                    "não definido"
                  )}
                </p>
                <p>
                  <span className="font-semibold">Líder:</span>{" "}
                  {ginasioInfo.liderNome
                    ? ginasioInfo.liderNome
                    : ginasioInfo.em_disputa
                    ? "em disputa"
                    : "vago"}
                </p>
                {ginasioInfo.em_disputa && (
                  <p className="text-xs text-red-500">
                    Este ginásio está em disputa.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
