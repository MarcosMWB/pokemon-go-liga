"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PokemonSelect } from "@/components/PokemonSelect";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
} from "firebase/firestore";

export default function PageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const userId = searchParams.get("user");
  const liga = searchParams.get("liga");

  const [selectedPokemons, setSelectedPokemons] = useState<string[]>([]);
  const [savedPokemons, setSavedPokemons] = useState<string[]>([]);
  const [pokemonList, setPokemonList] = useState<{ name: string; id: number }[]>([]);
  const [loading, setLoading] = useState(false);

  // 1. garantir auth
  useEffect(() => {
    const unsub = auth.onAuthStateChanged((current) => {
      if (!current || !userId || current.uid !== userId) {
        router.push("/");
      }
    });
    return () => unsub();
  }, [userId, router]);

  // 2. se faltar param, manda embora
  useEffect(() => {
    if (!userId || !liga) router.push("/");
  }, [userId, liga, router]);

  // 3. lista de pokémon (igual)
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

      const extraForms = [
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
        "Meowth (Galar)",
        "Ponyta (Galar)",
        "Rapidash (Galar)",
        "Slowpoke (Galar)",
        "Slowbro (Galar)",
        "Farfetch’d (Galar)",
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
      ].map((name, i) => ({ name, id: 10000 + i }));

      setPokemonList([...formatted, ...extraForms]);
    };

    fetchPokemonList();
  }, []);

  // 4. buscar participação e pokémon já salvos (versão Firestore)
  useEffect(() => {
    const fetchParticipacaoExistente = async () => {
      if (!userId || !liga) return;

      // temporada ativa
      const temporadaSnap = await getDocs(
        query(collection(db, "temporadas"), where("ativa", "==", true))
      );
      const temporada = temporadaSnap.docs[0];
      if (!temporada) return;

      // liga pelo nome
      const ligaSnap = await getDocs(
        query(collection(db, "ligas"), where("nome", "==", liga))
      );
      const ligaDoc = ligaSnap.docs[0];
      if (!ligaDoc) return;

      // participação desse user nessa liga/temporada
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
        // pega pokémon associados
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

  const formatName = (name: string) =>
    name
      .split("-")
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(" ");

  const handleRemove = (name: string) => {
    if (savedPokemons.includes(name)) return;
    setSelectedPokemons((prev) => prev.filter((p) => p !== name));
  };

  const handleSubmit = async () => {
    if (!userId || !liga) return;

    setLoading(true);

    // temporada ativa
    const temporadaSnap = await getDocs(
      query(collection(db, "temporadas"), where("ativa", "==", true))
    );
    const temporada = temporadaSnap.docs[0];
    if (!temporada) {
      console.error("sem temporada ativa no firestore");
      setLoading(false);
      return;
    }

    // liga
    const ligaSnap = await getDocs(
      query(collection(db, "ligas"), where("nome", "==", liga))
    );
    const ligaDoc = ligaSnap.docs[0];
    if (!ligaDoc) {
      console.error("liga não encontrada:", liga);
      setLoading(false);
      return;
    }

    // participação existente?
    const partSnap = await getDocs(
      query(
        collection(db, "participacoes"),
        where("usuario_id", "==", userId),
        where("liga_id", "==", ligaDoc.id),
        where("temporada_id", "==", temporada.id)
      )
    );
    let participacaoId = partSnap.docs[0]?.id as string | undefined;

    // criar se não tiver
    if (!participacaoId) {
      const nova = await addDoc(collection(db, "participacoes"), {
        usuario_id: userId,
        liga_id: ligaDoc.id,
        liga_nome: liga, // pra facilitar listar depois
        temporada_id: temporada.id,
        equipe_registrada: true,
        createdAt: Date.now(),
      });
      participacaoId = nova.id;
    }

    const novos = selectedPokemons.filter((p) => !savedPokemons.includes(p));

    if (selectedPokemons.length > 6) {
      alert("Limite de 6 Pokémon atingido.");
      setLoading(false);
      return;
    }

    if (novos.length > 0 && participacaoId) {
      // insere um doc por pokémon
      for (const nome of novos) {
        await addDoc(collection(db, "pokemon"), {
          nome,
          participacao_id: participacaoId,
        });
      }
      setSavedPokemons([...savedPokemons, ...novos]);
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-blue-50 py-10 px-4">
      <div className="max-w-2xl mx-auto bg-white p-6 rounded shadow">
        <h1 className="text-2xl font-bold mb-4 text-blue-800">
          {savedPokemons.length > 0 ? "Editar Equipe" : "Cadastrar Equipe"}
        </h1>

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
              {selectedPokemons.map((p) => (
                <li
                    key={p}
                    className="flex justify-between items-center bg-yellow-100 px-3 py-1 rounded"
                  >
                    <span className="text-blue-800 font-bold">{p}</span>
                    {!savedPokemons.includes(p) && (
                      <button
                        onClick={() => handleRemove(p)}
                        className="text-red-600 font-bold hover:underline"
                      >
                        Remover
                      </button>
                    )}
                  </li>
              ))}
            </ul>
          </div>
        )}

        {selectedPokemons.length >= 6 && (
          <p className="mt-2 text-sm text-red-500">
            Limite de 6 Pokémon atingido.
          </p>
        )}

        <button
          onClick={handleSubmit}
          disabled={
            loading ||
            selectedPokemons.length === 0 ||
            selectedPokemons.length > 6
          }
          className="mt-6 w-full py-3 bg-yellow-600 hover:bg-yellow-700 text-white font-semibold rounded disabled:opacity-50"
        >
          {loading
            ? "Salvando..."
            : savedPokemons.length > 0
            ? "Salvar Edição"
            : "Salvar Equipe"}
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
