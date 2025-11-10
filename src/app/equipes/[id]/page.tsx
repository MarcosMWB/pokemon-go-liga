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

type Liga = {
  id: string;
  nome: string;
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

  const [ligas, setLigas] = useState<Liga[]>([]);
  const [ligaSelecionada, setLigaSelecionada] = useState<string>(""); // nome da liga

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

        // 2) pegar todas as ligas pra montar o select
        const ligasSnap = await getDocs(collection(db, "ligas"));
        const ligasList: Liga[] = ligasSnap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            nome: data.nome || d.id,
          };
        });
        setLigas(ligasList);

        // 3) participações do usuário
        const partSnap = await getDocs(
          query(collection(db, "participacoes"), where("usuario_id", "==", id))
        );

        // 4) para cada participação, buscar os pokémon dela
        const parts: Participacao[] = [];
        for (const d of partSnap.docs) {
          const data = d.data() as any;

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
            liga_nome: data.liga_nome, // esse campo você já salva na criação
            pokemon: pokemons,
          });
        }

        setParticipacoes(parts);

        // se ainda não tem liga selecionada, seleciona a primeira que existir
        if (ligasList.length > 0 && !ligaSelecionada) {
          setLigaSelecionada("Great");
        }
      } catch (e: any) {
        setErro(e.message || "Erro ao carregar equipes.");
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, router]);

  if (loading) return <p className="p-8">Carregando...</p>;
  if (erro) return <p className="p-8 text-red-600">{erro}</p>;
  if (!usuario) return <p className="p-8">Usuário não encontrado.</p>;

  // filtra participações pela liga selecionada
  const participacoesDaLiga = participacoes.filter(
    (p) => !ligaSelecionada || p.liga_nome === ligaSelecionada
  );

  // agora só conta como "registrada" se tiver pelo menos 6 pokémon
  const temEquipeNaLigaSelecionada = participacoesDaLiga.some(
    (p) => p.pokemon && p.pokemon.length >= 6
  );

  return (
    <div className="min-h-screen bg-blue-50 py-10 px-4">
      <div className="max-w-3xl mx-auto bg-white p-8 rounded shadow">
        <div className="flex items-center justify-between gap-4 mb-6">
          <h1 className="text-2xl font-bold text-blue-800">
            Equipes de {usuario.nome ?? "Treinador"}
          </h1>

          {/* select de liga */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Liga
            </label>
            <select
              value={ligaSelecionada}
              onChange={(e) => setLigaSelecionada(e.target.value)}
              className="border rounded px-2 py-1 text-sm"
            >
              {ligas.map((l) => (
                <option key={l.id} value={l.nome}>
                  {l.nome}
                </option>
              ))}
            </select>
          </div>
        </div>

        {participacoesDaLiga.length > 0 ? (
          participacoesDaLiga.map((p) => (
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
          <p className="text-gray-600 mb-4">
            Nenhuma equipe registrada nessa liga ainda.
          </p>
        )}

        {/* botão pra cadastrar SÓ da liga selecionada */}
        {isOwnProfile && ligaSelecionada && !temEquipeNaLigaSelecionada && (
          <div className="mt-8 space-y-4">
            <h2 className="text-lg font-semibold text-blue-700">
              Cadastrar Equipe:
            </h2>
            <Link
              href={`/cadastro/equipe?user=${id}&liga=${encodeURIComponent(
                ligaSelecionada
              )}`}
            >
              <button className="block w-full mt-1 py-3 bg-yellow-600 hover:bg-yellow-700 text-white font-semibold rounded-md">
                Cadastrar equipe {ligaSelecionada}
              </button>
            </Link>
          </div>
        )}

        <footer className="mt-10 text-sm text-gray-500 text-center">
          {logadoEmail && `Logado como: ${logadoEmail}`}
        </footer>
      </div>
    </div>
  );
}
