"use client";

import type { User } from 'firebase/auth';
import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { PokemonSelect } from "@/components/PokemonSelect";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
} from "firebase/firestore";

// ---------- Utils de nome/slug ----------

function formatName(name: string) {
  return name
    .split("-")
    .map((w) => (w[0] ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function slugifyBase(displayBase: string) {
  return displayBase
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.’'"]/g, "")
    .replace(/\./g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

function suffixToToken(suf: string) {
  const s = suf.trim().toLowerCase();
  if (s === "alola") return "alola";
  if (s === "galar") return "galar";
  if (s === "hisui") return "hisui";
  if (s === "paldea") return "paldea";
  if (s === "hero") return "hero";
  if (s === "male") return "male";
  if (s === "female") return "female";
  // Tauros Paldea:
  if (s === "paldea combat") return "paldea-combat-breed";
  if (s === "paldea blaze") return "paldea-blaze-breed";
  if (s === "paldea aqua") return "paldea-aqua-breed";
  return s.replace(/\s+/g, "-");
}

function buildFormSlug(displayName: string): string | null {
  const m = displayName.match(/^(.*)\((.+)\)\s*$/);
  if (!m) return null;
  const base = slugifyBase(m[1]);
  const token = suffixToToken(m[2]);
  return `${base}-${token}`;
}

// URL sprite mini garantido por ID de forma
function spriteMiniById(id: number) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
}

// URL artwork oficial por ID base (melhor qualidade)
function officialArtworkById(id: number) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
}

// Miniatura que resolve forma → id real; fallback para artwork/base
function PokemonMini({
  displayName,
  baseId,
  size = 24,
}: {
  displayName: string;
  baseId?: number;
  size?: number;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const formSlug = buildFormSlug(displayName);
      if (formSlug) {
        try {
          const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${formSlug}`);
          if (res.ok) {
            const data = await res.json();
            const formId = data?.id as number | undefined;
            if (!cancelled && formId) {
              setSrc(spriteMiniById(formId));
              return;
            }
          }
        } catch {
          // segue para fallback
        }
      }
      if (baseId) {
        setSrc(officialArtworkById(baseId));
      } else {
        setSrc(null);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [displayName, baseId]);

  if (!src) return <span className="w-6 h-6 inline-block rounded bg-gray-300" />;

  return (
    <Image
      src={src}
      alt={displayName}
      width={size}
      height={size}
      onError={() => {
        if (baseId) {
          setSrc(spriteMiniById(baseId));
        } else {
          setSrc(null);
        }
      }}
    />
  );
}

// ----------------------------------------

export default function PageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const userId = searchParams.get("user");
  const liga = searchParams.get("liga");

  const [selectedPokemons, setSelectedPokemons] = useState<string[]>([]);
  const [savedPokemons, setSavedPokemons] = useState<string[]>([]);
  const [pokemonList, setPokemonList] = useState<{ name: string; id: number }[]>([]);
  const [nameToId, setNameToId] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  // 1. auth
  useEffect(() => {
    const unsub = auth.onAuthStateChanged((current: User | null) => {
      if (!current || !userId || current.uid !== userId) {
        router.push('/');
      }
    });
    return () => unsub();
  }, [userId, router]);

  // 2. params obrigatórios
  useEffect(() => {
    if (!userId || !liga) router.push("/");
  }, [userId, liga, router]);

  // 3. dex base + formas extras (nome exibido) e mapa nome→id base
  useEffect(() => {
    const fetchPokemonList = async () => {
      const res = await fetch("https://pokeapi.co/api/v2/pokemon?limit=1010");
      const data = await res.json();

      const formatted = data.results.map(
        (p: { name: string }, i: number) => ({
          name: formatName(p.name),
          id: i + 1,
        })
      );

      const baseNameToId: Record<string, number> = {};
      for (const { name, id } of formatted) baseNameToId[name] = id;

      const extraFormsNames = [
        "Raichu (Alola)",
        "Meowth (Alola)",
        "Meowth (Galar)",
        "Diglett (Alola)",
        "Dugtrio (Alola)",
        "Vulpix (Alola)",
        "Ninetales (Alola)",
        "Sandshrew (Alola)",
        "Sandslash (Alola)",
        "Grimer (Alola)",
        "Muk (Alola)",
        "Geodude (Alola)",
        "Graveler (Alola)",
        "Golem (Alola)",
        "Exeggutor (Alola)",
        "Marowak (Alola)",
        "Ponyta (Galar)",
        "Rapidash (Galar)",
        "Slowpoke (Galar)",
        "Slowbro (Galar)",
        "Farfetchd (Galar)",
        "Weezing (Galar)",
        "Mr. Mime (Galar)",
        "Articuno (Galar)",
        "Zapdos (Galar)",
        "Moltres (Galar)",
        "Slowking (Galar)",
        "Corsola (Galar)",
        "Zigzagoon (Galar)",
        "Linoone (Galar)",
        "Darumaka (Galar)",
        "Darmanitan (Galar)",
        "Yamask (Galar)",
        "Stunfisk (Galar)",
        "Growlithe (Hisui)",
        "Arcanine (Hisui)",
        "Voltorb (Hisui)",
        "Electrode (Hisui)",
        "Typhlosion (Hisui)",
        "Qwilfish (Hisui)",
        "Sneasel (Hisui)",
        "Samurott (Hisui)",
        "Lilligant (Hisui)",
        "Zorua (Hisui)",
        "Zoroark (Hisui)",
        "Braviary (Hisui)",
        "Sliggoo (Hisui)",
        "Goodra (Hisui)",
        "Avalugg (Hisui)",
        "Decidueye (Hisui)",
        "Wooper (Paldea)",
        "Tauros (Paldea Combat)",
        "Tauros (Paldea Blaze)",
        "Tauros (Paldea Aqua)",
        "Maushold (Paldea)",
        "Squawkabilly (Paldea)",
        "Palafin (Hero)",
        "Tatsugiri (Paldea)",
        "Dudunsparce (Paldea)",
        "Gimmighoul (Paldea)",
        "Ogerpon (Paldea)",
        "Terapagos (Paldea)",
        "Basculegion (Male)",
        "Basculegion (Female)",
      ];

      const extraForms = extraFormsNames.map((name, i) => ({ name, id: 10000 + i }));

      // Mapa final nome→ID da espécie-base (para fallback/artwork)
      const nameToIdMap: Record<string, number> = { ...baseNameToId };
      for (const name of extraFormsNames) {
        const base = name.split(" (")[0].trim();
        if (baseNameToId[base]) {
          nameToIdMap[name] = baseNameToId[base];
        }
      }

      setPokemonList([...formatted, ...extraForms]);
      setNameToId(nameToIdMap);
    };

    fetchPokemonList();
  }, []);

  // 4. carregar equipe já salva
  useEffect(() => {
    const fetchParticipacaoExistente = async () => {
      if (!userId || !liga) return;

      const temporadaSnap = await getDocs(
        query(collection(db, "temporadas"), where("ativa", "==", true))
      );
      const temporada = temporadaSnap.docs[0];
      if (!temporada) return;

      const ligaSnap = await getDocs(
        query(collection(db, "ligas"), where("nome", "==", liga))
      );
      const ligaDoc = ligaSnap.docs[0];
      if (!ligaDoc) return;

      const partSnap = await getDocs(
        query(
          collection(db, "participacoes"),
          where("usuario_id", "==", userId),
          where("liga_id", "==", ligaDoc.id),
          where("temporada_id", "==", temporada.id)
        )
      );
      const participacao = partSnap.docs[0];

      if (participacao) {
        const pokSnap = await getDocs(
          query(
            collection(db, "pokemon"),
            where("participacao_id", "==", participacao.id)
          )
        );
        const nomes = pokSnap.docs.map((d) => d.data().nome as string);
        setSelectedPokemons(nomes);
        setSavedPokemons(nomes);
      }
    };

    fetchParticipacaoExistente();
  }, [userId, liga]);

  const handleRemove = (name: string) => {
    if (savedPokemons.includes(name)) return;
    setSelectedPokemons((prev) => prev.filter((p) => p !== name));
  };

  const handleSubmit = async () => {
    if (!userId || !liga) return;

    const ok = window.confirm(
      "Definir é definitivo!\n" +
      "Ao confirmar, você está dizendo que essas escolhas são as que vai usar para competir.\n" +
      "Depois de confirmado, não será possível apagar os que já foram registrados.\n\n" +
      "Quer continuar?"
    );
    if (!ok) return;

    setLoading(true);

    const temporadaSnap = await getDocs(
      query(collection(db, "temporadas"), where("ativa", "==", true))
    );
    const temporada = temporadaSnap.docs[0];
    if (!temporada) {
      console.error("sem temporada ativa no firestore");
      setLoading(false);
      return;
    }

    const ligaSnap = await getDocs(
      query(collection(db, "ligas"), where("nome", "==", liga))
    );
    const ligaDoc = ligaSnap.docs[0];
    if (!ligaDoc) {
      console.error("liga não encontrada:", liga);
      setLoading(false);
      return;
    }

    const partSnap = await getDocs(
      query(
        collection(db, "participacoes"),
        where("usuario_id", "==", userId),
        where("liga_id", "==", ligaDoc.id),
        where("temporada_id", "==", temporada.id)
      )
    );
    let participacaoId = partSnap.docs[0]?.id as string | undefined;

    if (!participacaoId) {
      const nova = await addDoc(collection(db, "participacoes"), {
        usuario_id: userId,
        liga_id: ligaDoc.id,
        liga_nome: liga,
        temporada_id: temporada.id,
        equipe_registrada: true,
        createdAt: Date.now(),
      });
      participacaoId = nova.id;
    }

    // defesa contra múltiplas abas
    const pokSnapAtual = await getDocs(
      query(collection(db, "pokemon"), where("participacao_id", "==", participacaoId))
    );
    const pokemonsAtuais = pokSnapAtual.docs.map((d) => d.data().nome as string);

    const novos = selectedPokemons.filter((p) => !pokemonsAtuais.includes(p));
    const vagas = 6 - pokemonsAtuais.length;
    if (vagas <= 0) {
      alert("Você já tem 6 Pokémon registrados para esta liga/temporada.");
      setSelectedPokemons(pokemonsAtuais);
      setSavedPokemons(pokemonsAtuais);
      setLoading(false);
      return;
    }

    const aInserir = novos.slice(0, vagas);
    if (aInserir.length > 0) {
      for (const nome of aInserir) {
        await addDoc(collection(db, "pokemon"), {
          nome,
          participacao_id: participacaoId,
        });
      }
    }

    const final = [...pokemonsAtuais, ...aInserir];
    setSelectedPokemons(final);
    setSavedPokemons(final);
    setLoading(false);
  };

  const buttonLabel = useMemo(
    () =>
      loading ? "Salvando..." : savedPokemons.length > 0 ? "Definir escolhas" : "Salvar Equipe",
    [loading, savedPokemons.length]
  );

  return (
    <div className="min-h-screen bg-blue-50 py-10 px-4">
      <div className="max-w-2xl mx-auto bg-white p-6 rounded shadow">
        <div className="flex items-center gap-2 mb-4">
          <h1 className="text-2xl font-bold text-blue-800">Registrar Equipe</h1>
          <button
            type="button"
            onClick={() => setShowInfo((v) => !v)}
            className="w-6 h-6 rounded-full bg-blue-100 text-blue-800 text-sm flex items-center justify-center"
            title="Informações sobre registro"
          >
            ℹ️
          </button>
          <span>Atenção ao regulamento da liga {liga}</span>
        </div>

        {showInfo && (
          <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded p-3 text-sm text-gray-700">
            <p>• Você pode registrar até <strong>6 Pokémon</strong> por liga/temporada.</p>
            <p>• Pode adicionar aos poucos, um por vez.</p>
            <p>• Pokémon já registrados não podem ser removidos aqui — apenas os novos que ainda não foram salvos.</p>
            <p>• Só os Pokémon registrados ficam válidos para batalhas oficiais.</p>
            <p>• O jogo só aceita Pokémon com poder de combate limitado para a liga Great(1500) Ultra(2500) Master(Ilimitado).</p>
            <p>• Este campeonato aceita mega evolução, mantendo o limite de poder de combate da liga {liga}.</p>
          </div>
        )}

        <PokemonSelect
          value={selectedPokemons}
          onChange={setSelectedPokemons}
          pokemonList={pokemonList}
        />

        {selectedPokemons.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-sm text-gray-700">
              Pokémon selecionados ({selectedPokemons.length}/6):
            </p>
            <ul className="grid grid-cols-2 gap-2">
              {selectedPokemons.map((p) => {
                const baseName = p.replace(/\s*\(.+\)\s*$/, "");
                const baseId = nameToId[baseName];
                return (
                  <li
                    key={p}
                    className="flex flex-col items-center bg-yellow-100 px-3 py-1 rounded"
                  >
                    <span className="flex items-center gap-2 text-blue-800 font-bold">
                      <PokemonMini displayName={p} baseId={baseId} size={24} />
                      {p}
                    </span>
                    {!savedPokemons.includes(p) && (
                      <button
                        onClick={() => handleRemove(p)}
                        className="text-red-600 font-bold hover:underline"
                      >
                        Remover
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {selectedPokemons.length >= 6 && (
          <p className="mt-2 text-sm text-red-500">Limite de 6 Pokémon atingido.</p>
        )}

        <button
          onClick={handleSubmit}
          disabled={loading || selectedPokemons.length === 0}
          className="mt-6 w-full py-3 bg-yellow-600 hover:bg-yellow-700 text-white font-semibold rounded disabled:opacity-50"
        >
          {buttonLabel}
        </button>

        <button
          onClick={() => router.push(`/perfil/${userId}`)}
          className="mt-4 w-full py-2 bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold rounded"
        >
          Voltar
        </button>
      </div>
    </div>
  );
}
