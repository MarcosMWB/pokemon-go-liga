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
  writeBatch,
  increment,
} from "firebase/firestore";

type Usuario = {
  nome?: string;
  email?: string;
  friend_code?: string;
  pontosPresenca?: number;
  pp_consumidos?: number;              // campo oficial
  pontosPresencaConsumidos?: number;   // alias antigo (apenas leitura)
  pp_batonPass_uses?: number;          // quantas vezes já usou "Passar Bastão"
  pp_batonPass_temporadaId?: string;   // temporada em que esses usos valem
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

// custo dinâmico do Passar Bastão
// base = PPcustoBatonPass.valor
// up   = PPupBatonPass.valor
// uses = quantas vezes o jogador já usou na temporada atual
// ex: base=10, up=2 → 10, 12, 14, 16, 16, 16...
function computeBatonPassCost(base: number, up: number, uses: number) {
  const b = Number.isFinite(base) ? base : 5;
  const u = Number.isFinite(up) ? up : 0;
  const n = uses < 0 ? 0 : uses;
  const level = Math.min(n, 3); // até a 3ª vez (0, 1, 2, 3)
  return b + u * level;
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

  // configuração do custo dinâmico
  const [batonBaseCost, setBatonBaseCost] = useState<number>(5);
  const [batonUpCost, setBatonUpCost] = useState<number>(0);

  // temporada ativa (para resetar usos por temporada)
  const [temporadaAtiva, setTemporadaAtiva] = useState<{ id: string; nome?: string } | null>(null);

  // carrega config de custo (global) do Firestore
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const baseSnap = await getDoc(doc(db, "consumoPP", "PPcustoBatonPass"));
        if (baseSnap.exists()) {
          const v = (baseSnap.data() as any).valor;
          if (typeof v === "number") setBatonBaseCost(v);
        }

        const upSnap = await getDoc(doc(db, "consumoPP", "PPupBatonPass"));
        if (upSnap.exists()) {
          const v = (upSnap.data() as any).valor;
          if (typeof v === "number") setBatonUpCost(v);
        }
      } catch (e) {
        console.error("Erro ao carregar config de consumoPP", e);
      }
    };
    loadConfig();
  }, []);

  // carrega temporada ativa
  useEffect(() => {
    const loadTemporadaAtiva = async () => {
      try {
        const qTemp = query(
          collection(db, "temporadas"),
          where("ativa", "==", true)
        );
        const snap = await getDocs(qTemp);
        if (!snap.empty) {
          const d = snap.docs[0];
          const data = d.data() as any;
          setTemporadaAtiva({ id: d.id, nome: data.nome });
        } else {
          setTemporadaAtiva(null);
        }
      } catch (e) {
        console.warn("Erro carregando temporada ativa:", e);
      }
    };
    loadTemporadaAtiva();
  }, []);

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

  // PPs do usuário (total, consumidos, disponíveis) – usa pp_consumidos como oficial
  const pontosPresenca = usuario?.pontosPresenca ?? 0;
  const ppConsumidos = ((usuario as any)?.pp_consumidos ??
    usuario?.pontosPresencaConsumidos ??
    0) as number;
  const ppDisponiveis = Math.max(0, pontosPresenca - ppConsumidos);

  // usos do Baton Pass por temporada
  const batonUsesRaw = ((usuario as any)?.pp_batonPass_uses ?? 0) as number;
  const batonSeasonId = ((usuario as any)?.pp_batonPass_temporadaId ??
    null) as string | null;

  // se a temporada salva for diferente da temporada ativa, zera os usos para cálculo
  const batonUses =
    !temporadaAtiva?.id || batonSeasonId === temporadaAtiva.id
      ? Math.max(0, batonUsesRaw)
      : 0;

  const batonPassCost = computeBatonPassCost(batonBaseCost, batonUpCost, batonUses);

  async function handlePassarBastao(
    participacaoId: string,
    pokemonIndex: number,
    pokemonNome: string
  ) {
    if (!isOwnProfile) return;

    try {
      const userRef = doc(db, "usuarios", id);
      const pokQuery = query(
        collection(db, "pokemon"),
        where("participacao_id", "==", participacaoId),
        where("nome", "==", pokemonNome)
      );

      const [userSnap, pokSnap] = await Promise.all([
        getDoc(userRef),
        getDocs(pokQuery),
      ]);

      if (!userSnap.exists()) {
        alert("Usuário não encontrado no Firestore.");
        return;
      }

      if (pokSnap.empty) {
        alert("Pokémon não encontrado no servidor. Tente recarregar a página.");
        return;
      }

      const uData = userSnap.data() as any;
      const total: number = uData.pontosPresenca ?? 0;
      const consumidosAtual: number =
        (uData.pp_consumidos ?? uData.pontosPresencaConsumidos ?? 0) as number;

      const seasonIdAtiva = temporadaAtiva?.id ?? null;
      const storedSeasonId: string | null =
        (uData.pp_batonPass_temporadaId as string | undefined) ?? null;
      const rawUses: number = (uData.pp_batonPass_uses ?? 0) as number;

      const usesAtual =
        !seasonIdAtiva || storedSeasonId === seasonIdAtiva ? Math.max(0, rawUses) : 0;

      const custo = computeBatonPassCost(batonBaseCost, batonUpCost, usesAtual);
      const saldo = total - consumidosAtual;

      if (saldo < custo) {
        alert(
          `Você tem apenas ${saldo} Pontos de Presença. São necessários ${custo} PPs para passar o bastão.`
        );
        // sincroniza estado local com o servidor
        setUsuario((prev) =>
          prev
            ? {
                ...prev,
                pontosPresenca: total,
                pp_consumidos: consumidosAtual,
                pp_batonPass_uses: rawUses,
                pp_batonPass_temporadaId: storedSeasonId ?? undefined,
              }
            : prev
        );
        return;
      }

      const ok = window.confirm(
        `Remover ${pokemonNome} da equipe consumindo ${custo} Pontos de Presença?\n\n` +
          `PP disponíveis (atual no servidor): ${saldo}\n` +
          `O custo aumenta até a 3ª utilização em cada temporada.`
      );
      if (!ok) return;

      const pokemonRef = pokSnap.docs[0].ref;

      const novoConsumidos = consumidosAtual + custo;
      const novoUses = usesAtual + 1;

      const batch = writeBatch(db);
      batch.update(userRef, {
        pp_consumidos: increment(custo),
        pp_batonPass_uses: novoUses,
        pp_batonPass_temporadaId: seasonIdAtiva || null,
      });
      batch.delete(pokemonRef);
      await batch.commit();

      setUsuario((prev) =>
        prev
          ? {
              ...prev,
              pontosPresenca: total,
              pp_consumidos: novoConsumidos,
              pp_batonPass_uses: novoUses,
              pp_batonPass_temporadaId: seasonIdAtiva || undefined,
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

      alert(`Pokémon removido com sucesso. ${custo} Pontos de Presença foram consumidos.`);
    } catch (e: any) {
      console.error(e);
      alert("Não foi possível passar o bastão. Tente novamente em alguns instantes.");
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
          <p>
            PPs disponíveis: <strong>{ppDisponiveis}</strong>
          </p>
          <p className="mt-1 text-xs text-gray-600">
            Custo atual do “Passar Bastão”: <strong>{batonPassCost} PP</strong>{" "}
            (aumenta até a 3ª vez em cada temporada).
          </p>
        </div>
      )}

      {participacoesDaLiga.length > 0 ? (
        participacoesDaLiga.map((p) => {
          const canPassarGlobal =
            isOwnProfile && ppDisponiveis >= batonPassCost && batonPassCost > 0;

          return (
            <div key={p.id} className="mb-6 border-t pt-4">
              <h2 className="text-lg font-semibold text-blue-700">
                Liga: {p.liga_nome || "Desconhecida"}
              </h2>

              {p.pokemon && p.pokemon.length > 0 ? (
                <ul className="mt-2 space-y-2">
                  {p.pokemon.map((poke, j) => {
                    const baseId = idByName[poke.nome.replace(/\s*\(.+\)\s*$/, "")];

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
                            disabled={!canPassarGlobal || p.pokemon.length === 0}
                            className={`text-xs px-3 py-1 rounded font-semibold ${
                              canPassarGlobal && p.pokemon.length > 0
                                ? "bg-red-600 text-white hover:bg-red-700"
                                : "bg-gray-300 text-gray-500 cursor-not-allowed"
                            }`}
                            title={
                              canPassarGlobal
                                ? `Remover este Pokémon consumindo ${batonPassCost} Pontos de Presença`
                                : "Você não tem Pontos de Presença suficientes para usar Passar Bastão"
                            }
                          >
                            Passar Bastão (-{batonPassCost} PP)
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
          );
        })
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
