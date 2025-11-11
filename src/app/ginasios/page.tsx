"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import { TYPE_ICONS } from "@/utils/typeIcons";
import Image from "next/image";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  query,
  where,
  onSnapshot,
} from "firebase/firestore";

type Ginasio = {
  id: string;
  nome: string;
  tipo: string;
  lider_uid: string;
  lider_whatsapp?: string;
  em_disputa: boolean;
  insignia_icon?: string;
  liga?: string;
};

type Desafio = {
  id: string;
  ginasio_id: string;
  lider_uid: string;
  desafiante_uid: string;
  status: "pendente" | "concluido" | "conflito";
  resultado_lider: "lider" | "desafiante" | null;
  resultado_desafiante: "lider" | "desafiante" | null;
  createdAt: number;
  liga?: string;
};

type Bloqueio = {
  id: string;
  ginasio_id: string;
  desafiante_uid: string;
  proximo_desafio: number;
};

type Disputa = {
  id: string;
  ginasio_id: string;
  status: "inscricoes" | "batalhando" | "finalizado";
  liga?: string;
};

type Insignia = {
  id: string;
  ginasio_id: string;
  temporada_id: string;
};

type Liga = {
  id: string;
  nome: string;
};

export default function GinasiosPage() {
  const router = useRouter();
  const [userUid, setUserUid] = useState<string | null>(null);
  const [ginasios, setGinasios] = useState<Ginasio[]>([]);
  const [liderNomes, setLiderNomes] = useState<Record<string, string>>({});
  const [desafios, setDesafios] = useState<Desafio[]>([]);
  const [bloqueios, setBloqueios] = useState<Bloqueio[]>([]);
  const [disputas, setDisputas] = useState<Disputa[]>([]);
  const [participacoesDisputa, setParticipacoesDisputa] = useState<
    { disputa_id: string; usuario_uid: string }[]
  >([]);
  const [temporada, setTemporada] = useState<{ id: string; nome?: string } | null>(null);
  const [minhasInsignias, setMinhasInsignias] = useState<Insignia[]>([]);
  const [loading, setLoading] = useState(true);

  const [ligas, setLigas] = useState<Liga[]>([]);
  const [selectedLiga, setSelectedLiga] = useState<string>("");

  // 1) pegar usuário logado
  useEffect(() => {
    const unsub = auth.onAuthStateChanged((user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      setUserUid(user.uid);
    });
    return () => unsub();
  }, [router]);

  // 2) temporada ativa
  useEffect(() => {
    async function loadTemporada() {
      const qTemp = query(collection(db, "temporadas"), where("ativa", "==", true));
      const snap = await getDocs(qTemp);
      if (!snap.empty) {
        const d = snap.docs[0];
        const data = d.data() as any;
        setTemporada({ id: d.id, nome: data.nome });
      } else {
        setTemporada(null);
      }
    }
    loadTemporada();
  }, []);

  // 2.1) carregar ligas
  useEffect(() => {
    async function loadLigas() {
      const snap = await getDocs(collection(db, "ligas"));
      const list: Liga[] = snap.docs.map((d) => ({
        id: d.id,
        nome: (d.data() as any).nome,
      }));
      setLigas(list);
      if (list.length > 0) {
        setSelectedLiga(list[0].nome);
      }
    }
    loadLigas();
  }, []);

  // 3) carregar ginásios
  useEffect(() => {
    async function loadGinasios() {
      const snap = await getDocs(collection(db, "ginasios"));
      const list: Ginasio[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          nome: data.nome,
          tipo: data.tipo || "",
          liga: data.liga || "",
          lider_uid: data.lider_uid || "",
          lider_whatsapp: data.lider_whatsapp || "",
          em_disputa: data.em_disputa || false,
          insignia_icon: data.insignia_icon || "",
        };
      });
      setGinasios(list);
      setLoading(false);
    }
    loadGinasios();
  }, []);

  // 5) disputas abertas
  useEffect(() => {
    async function loadDisputas() {
      const snap = await getDocs(
        query(
          collection(db, "disputas_ginasio"),
          where("status", "in", ["inscricoes", "batalhando"])
        )
      );
      const list: Disputa[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          ginasio_id: data.ginasio_id,
          status: data.status,
          liga: data.liga || "",
        };
      });
      setDisputas(list);
    }
    loadDisputas();
  }, []);

  // 6) nomes dos líderes
  useEffect(() => {
    async function loadLideres() {
      const nomes: Record<string, string> = {};
      for (const g of ginasios) {
        if (!g.lider_uid) continue;
        const u = await getDoc(doc(db, "usuarios", g.lider_uid));
        if (u.exists()) {
          const ud = u.data() as any;
          nomes[g.lider_uid] = ud.nome || ud.email || g.lider_uid;
        } else {
          nomes[g.lider_uid] = g.lider_uid;
        }
      }
      setLiderNomes(nomes);
    }
    if (ginasios.length) {
      loadLideres();
    }
  }, [ginasios]);

  // 7) desafios do usuário
  useEffect(() => {
    if (!userUid) return;

    const qDesafiante = query(
      collection(db, "desafios_ginasio"),
      where("desafiante_uid", "==", userUid)
    );
    const unsub1 = onSnapshot(qDesafiante, (snap) => {
      setDesafios((prev) => {
        const outros = prev.filter((d) => d.desafiante_uid !== userUid);
        const meus = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            ginasio_id: data.ginasio_id,
            liga: data.liga || "",
            lider_uid: data.lider_uid,
            desafiante_uid: data.desafiante_uid,
            status: data.status,
            resultado_lider: data.resultado_lider ?? null,
            resultado_desafiante: data.resultado_desafiante ?? null,
            createdAt: data.createdAt,
          } as Desafio;
        });
        return [...outros, ...meus];
      });
    });

    const qLider = query(
      collection(db, "desafios_ginasio"),
      where("lider_uid", "==", userUid)
    );
    const unsub2 = onSnapshot(qLider, (snap) => {
      setDesafios((prev) => {
        const outros = prev.filter((d) => d.lider_uid !== userUid);
        const meus = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            ginasio_id: data.ginasio_id,
            liga: data.liga || "",
            lider_uid: data.lider_uid,
            desafiante_uid: data.desafiante_uid,
            status: data.status,
            resultado_lider: data.resultado_lider ?? null,
            resultado_desafiante: data.resultado_desafiante ?? null,
            createdAt: data.createdAt,
          } as Desafio;
        });
        return [...outros, ...meus];
      });
    });

    return () => {
      unsub1();
      unsub2();
    };
  }, [userUid]);

  // 8) bloqueios do usuário
  useEffect(() => {
    if (!userUid) return;
    const qBloq = query(
      collection(db, "bloqueios_ginasio"),
      where("desafiante_uid", "==", userUid)
    );
    const unsub = onSnapshot(qBloq, (snap) => {
      const list: Bloqueio[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          ginasio_id: data.ginasio_id,
          desafiante_uid: data.desafiante_uid,
          proximo_desafio: data.proximo_desafio,
        };
      });
      setBloqueios(list);
    });
    return () => unsub();
  }, [userUid]);

  // 9) minhas inscrições nas disputas
  useEffect(() => {
    if (!userUid) return;
    const qPart = query(
      collection(db, "disputas_ginasio_participantes"),
      where("usuario_uid", "==", userUid)
    );
    const unsub = onSnapshot(qPart, (snap) => {
      const list = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          disputa_id: data.disputa_id as string,
          usuario_uid: data.usuario_uid as string,
        };
      });
      setParticipacoesDisputa(list);
    });
    return () => unsub();
  }, [userUid]);

  // 10) minhas insígnias
  useEffect(() => {
    if (!userUid) return;
    const qIns = query(
      collection(db, "insignias"),
      where("usuario_uid", "==", userUid)
    );
    const unsub = onSnapshot(qIns, (snap) => {
      const list: Insignia[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          ginasio_id: data.ginasio_id,
          temporada_id: data.temporada_id || "",
        };
      });
      setMinhasInsignias(list);
    });
    return () => unsub();
  }, [userUid]);

  const handleDesafiar = async (g: Ginasio) => {
    if (!userUid) return;
    if (!g.lider_uid) return;

    const jaTem = minhasInsignias.some((i) => {
      if (i.ginasio_id !== g.id) return false;
      if (temporada?.id) {
        return i.temporada_id === temporada.id;
      }
      return false;
    });
    if (jaTem) {
      alert("Você já conquistou este ginásio nesta temporada.");
      return;
    }

    const pendente = desafios.find(
      (d) =>
        d.ginasio_id === g.id &&
        d.desafiante_uid === userUid &&
        d.status === "pendente"
    );
    if (pendente) return;

    await addDoc(collection(db, "desafios_ginasio"), {
      ginasio_id: g.id,
      liga: g.liga || selectedLiga || "",
      lider_uid: g.lider_uid,
      desafiante_uid: userUid,
      status: "pendente",
      resultado_lider: null,
      resultado_desafiante: null,
      createdAt: Date.now(),
    });
  };

  const handleEntrarDisputa = async (g: Ginasio, disputa: Disputa) => {
    if (!userUid) return;

    const ja = participacoesDisputa.find(
      (p) => p.disputa_id === disputa.id && p.usuario_uid === userUid
    );
    if (ja) return;

    await addDoc(collection(db, "disputas_ginasio_participantes"), {
      disputa_id: disputa.id,
      ginasio_id: g.id,
      usuario_uid: userUid,
      tipo_escolhido: "",
      liga: g.liga || selectedLiga || "",
      createdAt: Date.now(),
    });
  };

  const handleDeclarar = async (
    desafio: Desafio,
    vencedor: "lider" | "desafiante"
  ) => {
    if (!userUid) return;

    const ref = doc(db, "desafios_ginasio", desafio.id);
    const souLider = desafio.lider_uid === userUid;
    const souDesafiante = desafio.desafiante_uid === userUid;
    if (!souLider && !souDesafiante) return;

    await updateDoc(ref, {
      [souLider ? "resultado_lider" : "resultado_desafiante"]: vencedor,
    });

    // ... (resto do fluxo de dar insígnia você já tinha; não vou repetir aqui
    // porque o bug que você falou é só na parte de mostrar o botão)
  };

  const agora = Date.now();

  if (loading) return <p className="p-8">Carregando...</p>;

  const ginasiosFiltrados =
    selectedLiga && selectedLiga !== ""
      ? ginasios.filter((g) => (g.liga || "") === selectedLiga)
      : ginasios;

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between mb-4 gap-2">
        <h1 className="text-2xl font-bold">Ginásios</h1>
        {ligas.length > 0 && (
          <select
            value={selectedLiga}
            onChange={(e) => setSelectedLiga(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          >
            {ligas.map((l) => (
              <option key={l.id} value={l.nome}>
                {l.nome}
              </option>
            ))}
          </select>
        )}
      </div>

      {ginasiosFiltrados.map((g) => {
        // disputa aberta pra ESSE ginásio e MESMA liga
        const disputaDoGinasio = disputas.find(
          (d) =>
            d.ginasio_id === g.id &&
            d.status === "inscricoes" &&
            (d.liga || "") === (g.liga || selectedLiga || "")
        );

        const jaNaDisputa = disputaDoGinasio
          ? participacoesDisputa.some(
              (p) => p.disputa_id === disputaDoGinasio.id
            )
          : false;

        const meuDesafio = desafios.find(
          (d) =>
            d.ginasio_id === g.id &&
            (d.desafiante_uid === userUid || d.lider_uid === userUid) &&
            d.status === "pendente"
        );

        const meuBloqueio = bloqueios.find(
          (b) => b.ginasio_id === g.id && b.desafiante_uid === userUid
        );
        const bloqueado = meuBloqueio ? meuBloqueio.proximo_desafio > agora : false;

        const semLider = !g.lider_uid;

        const jaTemInsignia = minhasInsignias.some((i) => {
          if (i.ginasio_id !== g.id) return false;
          if (temporada?.id) return i.temporada_id === temporada.id;
          return false;
        });

        return (
          <div
            key={g.id}
            className="bg-white border rounded p-4 flex justify-between items-center"
          >
            <div>
              <h2 className="text-lg font-semibold">
                {g.nome}{" "}
                {g.em_disputa && (
                  <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded ml-2">
                    em disputa
                  </span>
                )}
              </h2>
              {g.liga && (
                <p className="text-xs text-gray-400 mb-1">Liga: {g.liga}</p>
              )}
              <p className="text-sm text-gray-600 flex items-center gap-2">
                Tipo:
                {g.tipo ? (
                  <>
                    {TYPE_ICONS[g.tipo] && (
                      <Image
                        src={TYPE_ICONS[g.tipo]}
                        alt={g.tipo}
                        width={20}
                        height={20}
                      />
                    )}
                    <span>{g.tipo}</span>
                  </>
                ) : (
                  <span>não definido</span>
                )}
              </p>
              <p className="text-sm text-gray-600">
                Líder: {g.lider_uid ? liderNomes[g.lider_uid] || g.lider_uid : "vago"}
              </p>
            </div>

            <div className="flex flex-col gap-2 items-end">
              {/* PRIORIDADE: se tem disputa aberta, mostra entrar na disputa
                  mesmo que tenha líder */}
              {disputaDoGinasio ? (
                <>
                  {jaNaDisputa ? (
                    <span className="text-xs text-gray-500">
                      Você já está na disputa
                    </span>
                  ) : userUid === g.lider_uid ? (
                    <span className="text-xs text-gray-500">
                      Você é o líder
                    </span>
                  ) : (
                    <button
                      onClick={() => handleEntrarDisputa(g, disputaDoGinasio)}
                      className="px-3 py-1 bg-purple-500 text-white rounded text-sm"
                    >
                      Entrar na disputa
                    </button>
                  )}
                  <Link
                    href={`/ginasios/${g.id}/disputa`}
                    className="text-xs text-blue-600 underline"
                  >
                    Ver disputa
                  </Link>
                </>
              ) : meuDesafio && meuDesafio.status === "pendente" ? (
                <div className="flex flex-col gap-2 items-end">
                  {/* aqui ficaria o declarar resultado, mantive estrutura */}
                  <span className="text-xs text-gray-500">
                    Você tem um desafio pendente.
                  </span>
                </div>
              ) : (
                <button
                  onClick={() => handleDesafiar(g)}
                  disabled={
                    bloqueado ||
                    semLider ||
                    jaTemInsignia ||
                    g.lider_uid === userUid
                  }
                  className="px-3 py-1 bg-yellow-500 text-white rounded text-sm disabled:opacity-50"
                >
                  {g.lider_uid === userUid
                    ? "Você é o líder"
                    : semLider
                    ? "Sem líder"
                    : jaTemInsignia
                    ? "Já ganhou"
                    : "Desafiar"}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
