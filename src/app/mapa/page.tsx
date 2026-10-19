"use client";

import { useState, useEffect } from "react";
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
      "Entre a lagoa e os caminhos que levam à Região Oceânica, a Insígnia do Cafubá celebra quem sabe ler o terreno, reunir aliados e transformar cada encontro em oportunidade.",
  },
  {
    nome: "Camboinhas",
    coordenadas: { top: "65%", left: "46%" },
    imagem: "/Insignia/camboinhas.png",
    descricao:
      "Com o mar de um lado e a lagoa do outro, Camboinhas inspira batalhas de horizonte amplo: visão de equipe, calma para esperar o momento certo e coragem para avançar.",
  },
  {
    nome: "Engenho do Mato",
    coordenadas: { top: "8%", left: "95%" },
    imagem: "/Insignia/engenhodomato.png",
    descricao:
      "No verde do Engenho do Mato, a pressa fica para trás. Esta insígnia é para treinadores pacientes, atentos aos detalhes e prontos para trilhar o próprio caminho.",
  },
  {
    nome: "Itacoatiara",
    coordenadas: { top: "90%", left: "70%" },
    imagem: "/Insignia/itacoatiara.png",
    descricao:
      "A imponência do Costão e a energia do mar dão o tom de Itacoatiara. Aqui, ousadia sem preparo não basta: é preciso escolher a hora de atacar e sustentar a estratégia.",
  },
  {
    nome: "Itaipu",
    coordenadas: { top: "81%", left: "66%" },
    imagem: "/Insignia/itaipu.png",
    descricao:
      "Entre a praia, a lagoa e a história de Itaipu, esta insígnia homenageia quem mantém a cabeça fria e encontra força no equilíbrio, na experiência e na persistência.",
  },
  {
    nome: "Jacaré",
    coordenadas: { top: "7%", left: "50%" },
    imagem: "/Insignia/jacare.png",
    descricao:
      "Inspirada nos caminhos e nas águas do Jacaré, a insígnia pede flexibilidade: observar o que muda, adaptar a equipe e nunca subestimar uma boa virada.",
  },
  {
    nome: "Maravista",
    coordenadas: { top: "45%", left: "65%" },
    imagem: "/Insignia/maravista.png",
    descricao:
      "Maravista tem clima de jornada compartilhada. Sua insígnia valoriza quem evolui a cada desafio, aprende com a comunidade e constrói vitórias passo a passo.",
  },
  {
    nome: "Piratininga",
    coordenadas: { top: "55%", left: "19%" },
    imagem: "/Insignia/piratininga.png",
    descricao:
      "Às margens da Lagoa de Piratininga e perto da orla, este ginásio combina movimento e estratégia. A insígnia é conquistada por quem enxerga oportunidades antes que a maré vire.",
  },
  {
    nome: "Santo Antônio",
    coordenadas: { top: "20%", left: "58%" },
    imagem: "/Insignia/santoantonio.png",
    descricao:
      "O grande palco da Região Oceânica. No Great Plateau, a jornada dos melhores treinadores ganha seu capítulo decisivo: aqui se coroa o Campeão da Região e se desafia a Elite 4.",
  },
  {
    nome: "Serra Grande",
    coordenadas: { top: "22%", left: "80%" },
    imagem: "/Insignia/serragrande.png",
    descricao:
      "Serra Grande convida a olhar a jornada de cima: cada passo conta, cada recurso precisa ser bem usado. Esta insígnia celebra preparo, constância e visão de longo prazo.",
  },
  {
    nome: "Jardim Imbuí",
    coordenadas: { top: "38%", left: "7%" },
    imagem: "/Insignia/jardimimbui.png",
    descricao:
      "Mais recolhido entre as paisagens da região, o Jardim Imbuí é o território de quem observa antes de agir. Sua insígnia recompensa leitura de jogo, criatividade e precisão.",
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

type Liga = {
  id: string;
  nome: string;
};

type TituloRegional = { campeao?: string; elites: string[] };

export default function MapaPage() {
  const [regiaoAtiva, setRegiaoAtiva] = useState<RegiaoInfo | null>(null);
  const [ginasioInfo, setGinasioInfo] = useState<GinasioExtra | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);

  const [ligas, setLigas] = useState<Liga[]>([]);
  const [ligaSelecionada, setLigaSelecionada] = useState<string>("Great");
  const [tituloRegional, setTituloRegional] = useState<TituloRegional>({ elites: [] });

  useEffect(() => {
    if (!regiaoAtiva) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setRegiaoAtiva(null);
        setGinasioInfo(null);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [regiaoAtiva]);

  // carrega ligas da coleção "ligas"
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, "ligas"));
        const list: Liga[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            nome: data.nome || d.id,
          };
        });
        setLigas(list);
      } catch (e) {
        console.warn("erro carregando ligas", e);
      }
    })();
  }, []);

  const handleAbrirRegiao = async (regiao: RegiaoInfo) => {
    setRegiaoAtiva(regiao);
    setGinasioInfo(null);
    setLoadingInfo(true);

    if (regiao.nome === "Santo Antônio") {
      try {
        const [champSnap, eliteSnap] = await Promise.all([
          getDoc(doc(db, "regiao_campeao", "great_plateau")),
          getDocs(query(collection(db, "elite4"), where("liga", "==", ligaSelecionada))),
        ]);
        const champ = champSnap.exists() ? champSnap.data() : null;
        const eliteRows = eliteSnap.docs.map((d) => ({ id: d.id, data: d.data() })).sort((a, b) => Number(a.data.pos || 0) - Number(b.data.pos || 0)).slice(0, 4);
        const elites = await Promise.all(eliteRows.map(async (d) => {
          const data = d.data;
          if (data.nome || data.usuario_nome) return String(data.nome || data.usuario_nome);
          const uid = data.usuario_uid || data.uid;
          if (!uid) return d.id;
          const user = await getDoc(doc(db, "usuarios", uid));
          return user.exists() ? String(user.data().nome || user.data().nick || uid) : uid;
        }));
        setTituloRegional({ campeao: champ?.campeao_nome, elites });
      } catch (e) { console.warn("erro carregando campeões da região", e); setTituloRegional({ elites: [] }); }
      setGinasioInfo(null);
      setLoadingInfo(false);
      return;
    } else setTituloRegional({ elites: [] });

    try {
      // se NÃO tem liga selecionada, faz o que já fazia
      if (!ligaSelecionada) {
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
        setLoadingInfo(false);
        return;
      }

      // se TEM liga selecionada, precisamos achar o ginásio daquela liga
      // primeiro tentamos campo "liga"
      const qLiga = query(
        collection(db, "ginasios"),
        where("nome", "==", regiao.nome),
        where("liga", "==", ligaSelecionada)
      );
      const snapLiga = await getDocs(qLiga);

      let gDocFound = snapLiga.docs[0];

      // se não achou pelo campo "liga", tenta "liga_nome" (porque seu BD varia)
      if (!gDocFound) {
        const qLigaNome = query(
          collection(db, "ginasios"),
          where("nome", "==", regiao.nome),
          where("liga_nome", "==", ligaSelecionada)
        );
        const snapLigaNome = await getDocs(qLigaNome);
        gDocFound = snapLigaNome.docs[0];
      }

      if (!gDocFound) {
        // não tem ginásio dessa liga nessa região
        setGinasioInfo({
          tipo: undefined,
          liderNome: undefined,
          em_disputa: false,
        });
        setLoadingInfo(false);
        return;
      }

      const gData = gDocFound.data() as any;

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
    <div className="relative w-full max-w-5xl mx-auto space-y-5 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
        <h1 className="text-3xl font-bold text-center sm:text-left">
          Mapa da Liga - Região Oceânica
        </h1>
        <p className="mt-2 max-w-2xl text-base leading-7 text-slate-700">Toque em uma insígnia no mapa ou escolha um bairro na lista para ver o ginásio, o líder e a situação da região.</p>
        </div>

        <div>
          <label className="block mb-1 text-sm font-semibold text-slate-700">
            Filtrar por liga
          </label>
          <select
            value={ligaSelecionada}
            onChange={(e) => {
              setLigaSelecionada(e.target.value);
              // fechar modal atual porque a info pode mudar
              setRegiaoAtiva(null);
              setGinasioInfo(null);
            }}
            className="min-h-11 w-full rounded-lg border border-slate-400 bg-white px-3 text-base"
          >
            <option value="">Todas as ligas</option>
            {ligas.map((l) => (
              <option key={l.id} value={l.nome}>
                {l.nome}
              </option>
            ))}
          </select>
        </div>
      </div>

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
            aria-label={`Ver informações de ${regiao.nome}`}
            title={`Ver ${regiao.nome}`}
            className="absolute flex min-h-12 min-w-12 items-center justify-center rounded-full bg-white shadow ring-2 ring-white hover:bg-yellow-100 focus-visible:z-10"
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

      <section aria-labelledby="lista-bairros-heading" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 id="lista-bairros-heading" className="text-lg font-bold text-slate-950">Escolha pelo nome do bairro</h2>
        <p className="mt-1 text-sm text-slate-700">Se for difícil tocar no ponto do mapa, use um destes botões.</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {regioes.map((regiao) => <button key={regiao.nome} type="button" onClick={() => handleAbrirRegiao(regiao)} className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left font-medium text-slate-900 hover:bg-blue-50 focus-visible:ring-2 focus-visible:ring-blue-700">{regiao.nome}</button>)}
        </div>
      </section>

      {regiaoAtiva && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/60 p-4 z-50" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setRegiaoAtiva(null); setGinasioInfo(null); } }}>
          <div role="dialog" aria-modal="true" aria-labelledby="map-region-title" className="relative max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 text-center shadow-xl sm:p-6">
            <button
              onClick={() => {
                setRegiaoAtiva(null);
                setGinasioInfo(null);
              }}
              aria-label="Fechar informações do bairro"
              className="absolute right-3 top-3 flex min-h-11 min-w-11 items-center justify-center rounded-lg text-2xl font-bold text-slate-700 hover:bg-slate-100 hover:text-red-700"
            >
              ×
            </button>
            <h2 id="map-region-title" className="pr-10 text-2xl font-bold mb-2">{regiaoAtiva.nome}</h2>
            <Image
              src={regiaoAtiva.imagem}
              alt={`Insígnia de ${regiaoAtiva.nome}`}
              width={80}
              height={80}
              className="mx-auto mb-4"
            />
            <p className="mb-4">{regiaoAtiva.descricao}</p>

            {regiaoAtiva.nome === "Santo Antônio" && (
              <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-left text-sm">
                <p><b>Campeão da Região:</b> {tituloRegional.campeao || "Ainda não definido"}</p>
                <p className="mt-2 font-semibold">Elite 4 — {ligaSelecionada}</p>
                {tituloRegional.elites.length ? <ol className="list-decimal pl-5">{tituloRegional.elites.map((nome, i) => <li key={`${nome}-${i}`}>{nome}</li>)}</ol> : <p>Os quatro membros ainda não estão configurados para esta liga.</p>}
                <a href="/desafio-dos-campeoes" className="mt-2 inline-block text-blue-700 underline">Ver Desafio dos Campeões</a>
              </div>
            )}

            {ligaSelecionada && (
              <p className="text-xs text-gray-500 mb-2">
                Liga selecionada: {ligaSelecionada}
              </p>
            )}

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
