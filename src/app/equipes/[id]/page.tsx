"use client";

import type { User } from "firebase/auth";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { auth, db } from "@/lib/firebase";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  runTransaction,
  increment,
  deleteDoc,
} from "firebase/firestore";

type Usuario = {
  nome?: string;
  email?: string;
  friend_code?: string;
  pontosPresenca?: number;
  pp_consumidos?: number;
};

type Participacao = { id: string; liga_nome?: string; pokemon: { nome: string }[] };
type Liga = { id: string; nome: string };

function formatName(name: string) {
  return name
    .split("-")
    .map((w) => (w[0] ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// remove acentos/pontuação para slugs
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

// traduz sufixo entre parênteses para token de forma
function suffixToToken(suf: string) {
  const s = suf.trim().toLowerCase();
  if (s === "alola") return "alola";
  if (s === "galar") return "galar";
  if (s === "hisui") return "hisui";
  if (s === "paldea") return "paldea"; // genérico (Wooper)
  if (s === "hero") return "hero";
  if (s === "male") return "male";
  if (s === "female") return "female";
  // Tauros Paldea especiais:
  if (s === "paldea combat") return "paldea-combat-breed";
  if (s === "paldea blaze") return "paldea-blaze-breed";
  if (s === "paldea aqua") return "paldea-aqua-breed";
  return s.replace(/\s+/g, "-");
}

// tenta montar slug de forma a partir do displayName
function buildFormSlug(displayName: string): string | null {
  const m = displayName.match(/^(.*)\((.+)\)\s*$/);
  if (!m) return null;
  const base = slugifyBase(m[1]);
  const token = suffixToToken(m[2]);
  return `${base}-${token}`;
}

// componente de miniatura com resolução automática (forma → id → sprite)
function PokemonThumb({
  displayName,
  baseId,
  size = 32,
}: {
  displayName: string;
  baseId?: number;
  size?: number;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;

    const run = async () => {
      const formSlug = buildFormSlug(displayName);

      if (formSlug) {
        try {
          const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${formSlug}`);
          if (res.ok) {
            const data = await res.json();
            const formId = data?.id;
            if (!canceled && formId) {
              setSrc(
                `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${formId}.png`
              );
              return;
            }
          }
        } catch {
          // fallback
        }
      }

      if (baseId) {
        setSrc(
          `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${baseId}.png`
        );
      } else {
        setSrc(null);
      }
    };

    run();
    return () => {
      canceled = true;
    };
  }, [displayName, baseId]);

  if (!src) return <div className="w-8 h-8 rounded bg-gray-200" />;

  return (
    <Image
      src={src}
      alt={displayName}
      width={size}
      height={size}
      onError={() => {
        if (baseId) {
          setSrc(
            `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${baseId}.png`
          );
        } else {
          setSrc(null);
        }
      }}
      className="rounded"
    />
  );
}

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
  const [ligaSelecionada, setLigaSelecionada] = useState<string>("");

  const [idByName, setIdByName] = useState<Record<string, number>>({});

  // auth + carga principal
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (current: User | null) => {
      if (!current) {
        router.replace("/login");
        return;
      }

      setLogadoEmail(current.email ?? null);
      setIsOwnProfile(current.uid === id);

      try {
        const snap = await getDoc(doc(db, "usuarios", id));
        if (!snap.exists()) {
          setErro("Usuário não encontrado.");
          setLoading(false);
          return;
        }
        setUsuario(snap.data() as Usuario);

        const ligasSnap = await getDocs(collection(db, "ligas"));
        const ligasList: Liga[] = ligasSnap.docs.map((d) => {
          const data = d.data() as any;
          return { id: d.id, nome: data.nome || d.id };
        });
        setLigas(ligasList);

        const partSnap = await getDocs(
          query(collection(db, "participacoes"), where("usuario_id", "==", id))
        );

        const parts: Participacao[] = [];
        for (const d of partSnap.docs) {
          const data = d.data() as any;
          const pokSnap = await getDocs(
            query(collection(db, "pokemon"), where("participacao_id", "==", d.id))
          );
          const pokemons = pokSnap.docs.map((p) => ({
            nome: (p.data() as any).nome as string,
          }));
          parts.push({ id: d.id, liga_nome: data.liga_nome, pokemon: pokemons });
        }
        setParticipacoes(parts);

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

  // dex base para mapear espécie → id
  useEffect(() => {
    const loadDex = async () => {
      try {
        const res = await fetch("https://pokeapi.co/api/v2/pokemon?limit=1010");
        const data = await res.json();
        const map: Record<string, number> = {};
        data.results.forEach((p: { name: string }, i: number) => {
          map[formatName(p.name)] = i + 1; // 1-based
        });
        setIdByName(map);
      } catch {
        setIdByName({});
      }
    };
    loadDex();
  }, []);

  const participacoesDaLiga = useMemo(
    () => participacoes.filter((p) => !ligaSelecionada || p.liga_nome === ligaSelecionada),
    [participacoes, ligaSelecionada]
  );

  const temEquipeNaLigaSelecionada = useMemo(
    () => participacoesDaLiga.some((p) => p.pokemon && p.pokemon.length >= 6),
    [participacoesDaLiga]
  );

  // PPs do usuário (total, consumidos, disponíveis)
  const pontosPresenca = usuario?.pontosPresenca ?? 0;
  const ppConsumidos = usuario?.pp_consumidos ?? 0;
  const ppDisponiveis = Math.max(0, pontosPresenca - ppConsumidos);

  async function handlePassarBastao(
    participacaoId: string,
    pokemonIndex: number,
    pokemonNome: string
  ) {
    if (!isOwnProfile) return;

    const ok = window.confirm(
      `Remover ${pokemonNome} da equipe consumindo 5 Pontos de Presença?\n\n` +
      `Você tem atualmente ${ppDisponiveis} PPs disponíveis.`
    );
    if (!ok) return;

    try {
      // garantimos que ainda há esse Pokémon na participação (pegamos um doc)
      const pokSnap = await getDocs(
        query(
          collection(db, "pokemon"),
          where("participacao_id", "==", participacaoId),
          where("nome", "==", pokemonNome)
        )
      );

      if (pokSnap.empty) {
        alert("Pokémon não encontrado no servidor. Tente recarregar a página.");
        return;
      }

      const pokemonDoc = pokSnap.docs[0];
      const pokemonRef = pokemonDoc.ref;

      await runTransaction(db, async (tx) => {
        const userRef = doc(db, "usuarios", id);
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists()) {
          throw new Error("USUARIO_INEXISTENTE");
        }

        const uData = userSnap.data() as any;
        const total = (uData.pontosPresenca as number | undefined) ?? 0;
        const consumidos = (uData.pp_consumidos as number | undefined) ?? 0;
        const disponiveis = total - consumidos;

        if (disponiveis < 5) {
          throw new Error("SEM_PONTOS");
        }

        // cobra 5 PPs (campo só pode aumentar, regra já garante isso)
        tx.update(userRef, { pp_consumidos: increment(5) });

        // confere se o doc ainda existe
        const pokeSnapTx = await tx.get(pokemonRef);
        if (!pokeSnapTx.exists()) {
          throw new Error("POKEMON_JA_REMOVIDO");
        }
        const pdata = pokeSnapTx.data() as any;
        if (pdata.participacao_id !== participacaoId || pdata.nome !== pokemonNome) {
          throw new Error("POKEMON_DIVERGENTE");
        }

        // remove o Pokémon da equipe
        tx.delete(pokemonRef);
      });

      // se chegou aqui, deu certo: atualiza estado local
      setUsuario((prev) =>
        prev
          ? {
              ...prev,
              pp_consumidos: (prev.pp_consumidos ?? 0) + 5,
            }
          : prev
      );

      setParticipacoes((prev) =>
        prev.map((part) =>
          part.id === participacaoId
            ? {
                ...part,
                pokemon: part.pokemon.filter((_, idx) => idx !== pokemonIndex),
              }
            : part
        )
      );

      alert("Pokémon removido com sucesso. 5 Pontos de Presença foram consumidos.");
    } catch (e: any) {
      if (e?.message === "SEM_PONTOS") {
        alert("Você não tem Pontos de Presença suficientes para passar o bastão (mínimo 5).");
      } else {
        console.error(e);
        alert("Não foi possível passar o bastão. Tente novamente em alguns instantes.");
      }
    }
  }

  if (loading) return <p className="p-8">Carregando...</p>;
  if (erro) return <p className="p-8 text-red-600">{erro}</p>;
  if (!usuario) return <p className="p-8">Usuário não encontrado.</p>;

  return (
    <div className="max-w-3xl mx-auto bg-white p-8 rounded shadow">
      <div className="flex items-center justify-between gap-4 mb-4">
        <h1 className="text-2xl font-bold text-blue-800">
          Equipes de {usuario.nome ?? "Treinador"}
        </h1>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Liga</label>
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

      {isOwnProfile && (
        <div className="mb-4 text-sm text-gray-700 bg-blue-50 border border-blue-100 rounded px-3 py-2">
          <p>PPs disponíveis: <strong>{ppDisponiveis}</strong></p>
          <p className="mt-1 text-xs text-gray-600">
            Cada “Passar Bastão” consome 5 Pontos de Presença.
          </p>
        </div>
      )}

      {participacoesDaLiga.length > 0 ? (
        participacoesDaLiga.map((p) => (
          <div key={p.id} className="mb-6 border-t pt-4">
            <h2 className="text-lg font-semibold text-blue-700">
              Liga: {p.liga_nome || "Desconhecida"}
            </h2>

            {p.pokemon && p.pokemon.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {p.pokemon.map((poke, j) => {
                  const baseId = idByName[poke.nome.replace(/\s*\(.+\)\s*$/, "")];
                  const canPassar =
                    isOwnProfile && ppDisponiveis >= 5 && p.pokemon.length > 0;

                  return (
                    <li
                      key={j}
                      className="flex items-center justify-between gap-2 text-gray-700 bg-gray-50 rounded px-2 py-1"
                    >
                      <div className="flex items-center gap-2">
                        <PokemonThumb displayName={poke.nome} baseId={baseId} size={32} />
                        <span>{poke.nome}</span>
                      </div>

                      {isOwnProfile && (
                        <button
                          type="button"
                          onClick={() => handlePassarBastao(p.id, j, poke.nome)}
                          disabled={!canPassar}
                          className={`text-xs px-3 py-1 rounded font-semibold ${
                            canPassar
                              ? "bg-red-600 text-white hover:bg-red-700"
                              : "bg-gray-300 text-gray-500 cursor-not-allowed"
                          }`}
                          title={
                            canPassar
                              ? "Remover este Pokémon consumindo 5 Pontos de Presença"
                              : "Você precisa de pelo menos 5 Pontos de Presença disponíveis"
                          }
                        >
                          Passar Bastão (-5 PP)
                        </button>
                      )}
                    </li>
                  );
                })}
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

      {isOwnProfile && ligaSelecionada && !temEquipeNaLigaSelecionada && (
        <div className="mt-8 space-y-4">
          <h2 className="text-lg font-semibold text-blue-700">Cadastrar Equipe:</h2>
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
  );
}
