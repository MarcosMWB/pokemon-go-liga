"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { auth, db } from "@/lib/firebase";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";

type Usuario = {
  nome?: string;
  email?: string;
  friend_code?: string;
};

type Participacao = {
  id: string;
  liga_nome?: string;
  pokemon: { nome: string }[];
};

export default function EquipesPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [participacoes, setParticipacoes] = useState<Participacao[]>([]);
  const [logadoEmail, setLogadoEmail] = useState<string | null>(null);
  const [isOwnProfile, setIsOwnProfile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (current) => {
      if (!current) {
        router.replace("/login");
        return;
      }

      setLogadoEmail(current.email ?? null);
      setIsOwnProfile(current.uid === id);

      try {
        // 1) dados do usuário
        const snap = await getDoc(doc(db, "usuarios", id));
        if (!snap.exists()) {
          setErro("Usuário não encontrado.");
          setLoading(false);
          return;
        }
        setUsuario(snap.data() as Usuario);

        // 2) participações do usuário
        const partSnap = await getDocs(
          query(collection(db, "participacoes"), where("usuario_id", "==", id))
        );

        // 3) para cada participação, buscar os pokémon dela
        const parts: Participacao[] = [];
        for (const d of partSnap.docs) {
          const data = d.data() as any;

          // busca pokémon dessa participação
          const pokSnap = await getDocs(
            query(
              collection(db, "pokemon"),
              where("participacao_id", "==", d.id)
            )
          );
          const pokemons = pokSnap.docs.map((p) => ({
            nome: (p.data() as any).nome as string,
          }));

          parts.push({
            id: d.id,
            liga_nome: data.liga_nome, // você salva isso na hora que cria
            pokemon: pokemons,
          });
        }

        setParticipacoes(parts);
      } catch (e: any) {
        setErro(e.message || "Erro ao carregar equipes.");
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, [id, router]);

  if (loading) return <p className="p-8">Carregando...</p>;
  if (erro) return <p className="p-8 text-red-600">{erro}</p>;
  if (!usuario) return <p className="p-8">Usuário não encontrado.</p>;

  // agora só conta liga como "registrada" se tiver pelo menos 1 pokémon
  const ligasRegistradas = participacoes
    .filter((p) => p.pokemon && p.pokemon.length > 6)
    .map((p) => p.liga_nome)
    .filter(Boolean) as string[];

  const ligasFaltando = ["Great", "Master"].filter(
    (l) => !ligasRegistradas.includes(l)
  );

  return (
    <div className="min-h-screen bg-blue-50 py-10 px-4">
      <div className="max-w-3xl mx-auto bg-white p-8 rounded shadow">
        <h1 className="text-2xl font-bold text-blue-800 mb-4">
          Equipes de {usuario.nome ?? "Treinador"}
        </h1>

        {participacoes.length > 0 ? (
          participacoes.map((p) => (
            <div key={p.id} className="mb-6 border-t pt-4">
              <h2 className="text-lg font-semibold text-blue-700">
                Liga: {p.liga_nome || "Desconhecida"}
              </h2>
              {p.pokemon && p.pokemon.length > 0 ? (
                <ul className="list-disc list-inside text-gray-700 mt-2">
                  {p.pokemon.map((poke, j) => (
                    <li key={j}>{poke.nome}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-500 text-sm mt-2">
                  Nenhum Pokémon salvo para essa liga.
                </p>
              )}
            </div>
          ))
        ) : (
          <p className="text-gray-600 mb-4">Nenhuma equipe registrada ainda.</p>
        )}

        {ligasFaltando.length > 0 && isOwnProfile && (
          <div className="mt-8 space-y-4">
            <h2 className="text-lg font-semibold text-blue-700">
              Cadastrar Equipe:
            </h2>
            {ligasFaltando.map((liga) => (
              <Link key={liga} href={`/cadastro/equipe?user=${id}&liga=${liga}`}>
                <button className="block w-full mt-1 py-3 bg-yellow-600 hover:bg-yellow-700 text-white font-semibold rounded-md">
                  Cadastrar equipe {liga}
                </button>
              </Link>
            ))}
          </div>
        )}

        <div className="mt-2 space-y-4">
          <Link href="/jogadores">
            <button className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
              Ver Treinadores
            </button>
          </Link>
          <Link href="/mapa">
            <button className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
              Mapa
            </button>
          </Link>
          <Link href="/ginasios">
            <button className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
              Ginasios
            </button>
          </Link>
          <button
            onClick={() => router.push(`/perfil/${id}`)}
            className="mt-4 bg-blue-600 text-white px-3 py-2 rounded text-sm"
          >
            Ir ao perfil
          </button>
        </div>

        <footer className="mt-10 text-sm text-gray-500 text-center">
          {logadoEmail && `Logado como: ${logadoEmail}`}
        </footer>
      </div>
    </div>
  );
}
