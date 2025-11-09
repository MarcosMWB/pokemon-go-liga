"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  query,
  where,
} from "firebase/firestore";

type Ginasio = {
  id: string;
  nome: string;
  tipo: string;
  lider_uid: string;
  lider_whatsapp?: string;
  em_disputa: boolean;
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
  const [loading, setLoading] = useState(true);

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

  // 2) carregar ginásios
  useEffect(() => {
    async function loadGinasios() {
      const snap = await getDocs(collection(db, "ginasios"));
      const list: Ginasio[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          nome: data.nome,
          tipo: data.tipo || "",
          lider_uid: data.lider_uid || "",
          lider_whatsapp: data.lider_whatsapp || "",
          em_disputa: data.em_disputa || false,
        };
      });
      setGinasios(list);
      setLoading(false);
    }
    loadGinasios();
  }, []);

  // 3) ABRIR DISPUTA AUTOMÁTICA quando o ginásio está vago
  useEffect(() => {
    if (!userUid) return;
    if (!ginasios.length) return;

    async function abrir() {
      for (const g of ginasios) {
        // condição: sem líder e não está em disputa
        if ((!g.lider_uid || g.lider_uid === "") && !g.em_disputa) {
          // ver se já existe disputa aberta pra esse ginásio
          const q = query(
            collection(db, "disputas_ginasio"),
            where("ginasio_id", "==", g.id),
            where("status", "in", ["inscricoes", "batalhando"])
          );
          const snap = await getDocs(q);
          if (!snap.empty) continue;

          // cria disputa
          await addDoc(collection(db, "disputas_ginasio"), {
            ginasio_id: g.id,
            status: "inscricoes",
            tipo_original: g.tipo || "",
            lider_anterior_uid: g.lider_uid || "",
            temporada_id: "",
            createdAt: Date.now(),
          });

          // marca ginásio como em disputa
          await updateDoc(doc(db, "ginasios", g.id), {
            em_disputa: true,
          });
        }
      }
    }

    abrir();
  }, [userUid, ginasios]);

  // 4) carregar disputas abertas (pra mostrar "ver disputa")
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
        };
      });
      setDisputas(list);
    }
    loadDisputas();
  }, []);

  // 5) carregar nomes dos líderes
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

  // 6) carregar desafios do usuário
  useEffect(() => {
    if (!userUid) return;
    async function loadDesafios() {
      const q1 = query(
        collection(db, "desafios_ginasio"),
        where("desafiante_uid", "==", userUid)
      );
      const snap1 = await getDocs(q1);

      const q2 = query(
        collection(db, "desafios_ginasio"),
        where("lider_uid", "==", userUid)
      );
      const snap2 = await getDocs(q2);

      const all: Desafio[] = [];
      [...snap1.docs, ...snap2.docs].forEach((d) => {
        const data = d.data() as any;
        all.push({
          id: d.id,
          ginasio_id: data.ginasio_id,
          lider_uid: data.lider_uid,
          desafiante_uid: data.desafiante_uid,
          status: data.status,
          resultado_lider: data.resultado_lider ?? null,
          resultado_desafiante: data.resultado_desafiante ?? null,
          createdAt: data.createdAt,
        });
      });

      setDesafios(all);
    }
    loadDesafios();
  }, [userUid]);

  // 7) carregar bloqueios do usuário
  useEffect(() => {
    if (!userUid) return;
    async function loadBloq() {
      const q = query(
        collection(db, "bloqueios_ginasio"),
        where("desafiante_uid", "==", userUid)
      );
      const snap = await getDocs(q);
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
    }
    loadBloq();
  }, [userUid]);

  // 8) minhas inscrições nas disputas
  useEffect(() => {
    if (!userUid) return;
    async function loadPart() {
      const snap = await getDocs(
        query(
          collection(db, "disputas_ginasio_participantes"),
          where("usuario_uid", "==", userUid)
        )
      );
      const list = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          disputa_id: data.disputa_id as string,
          usuario_uid: data.usuario_uid as string,
        };
      });
      setParticipacoesDisputa(list);
    }
    loadPart();
  }, [userUid]);

  // ---------- handlers ----------

  const handleDesafiar = async (g: Ginasio) => {
    if (!userUid) return;

    const pendente = desafios.find(
      (d) =>
        d.ginasio_id === g.id &&
        d.desafiante_uid === userUid &&
        d.status === "pendente"
    );
    if (pendente) return;

    await addDoc(collection(db, "desafios_ginasio"), {
      ginasio_id: g.id,
      lider_uid: g.lider_uid,
      desafiante_uid: userUid,
      status: "pendente",
      resultado_lider: null,
      resultado_desafiante: null,
      createdAt: Date.now(),
    });

    // recarrega
    const q1 = query(
      collection(db, "desafios_ginasio"),
      where("desafiante_uid", "==", userUid)
    );
    const snap1 = await getDocs(q1);
    const q2 = query(
      collection(db, "desafios_ginasio"),
      where("lider_uid", "==", userUid)
    );
    const snap2 = await getDocs(q2);
    const all: Desafio[] = [];
    [...snap1.docs, ...snap2.docs].forEach((d) => {
      const data = d.data() as any;
      all.push({
        id: d.id,
        ginasio_id: data.ginasio_id,
        lider_uid: data.lider_uid,
        desafiante_uid: data.desafiante_uid,
        status: data.status,
        resultado_lider: data.resultado_lider ?? null,
        resultado_desafiante: data.resultado_desafiante ?? null,
        createdAt: data.createdAt,
      });
    });
    setDesafios(all);
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
      createdAt: Date.now(),
    });

    // recarrega minhas inscrições
    const snap = await getDocs(
      query(
        collection(db, "disputas_ginasio_participantes"),
        where("usuario_uid", "==", userUid)
      )
    );
    const list = snap.docs.map((d) => {
      const data = d.data() as any;
      return {
        disputa_id: data.disputa_id as string,
        usuario_uid: data.usuario_uid as string,
      };
    });
    setParticipacoesDisputa(list);
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

    const updated = await getDoc(ref);
    const d = updated.data() as any;
    const rl = d.resultado_lider;
    const rd = d.resultado_desafiante;

    if (rl && rd) {
      if (rl === rd) {
        // vencedor definido
        if (rl === "desafiante") {
          await addDoc(collection(db, "insignias"), {
            usuario_uid: desafio.desafiante_uid,
            ginasio_id: desafio.ginasio_id,
            createdAt: Date.now(),
          });
        }

        await addDoc(collection(db, "bloqueios_ginasio"), {
          ginasio_id: desafio.ginasio_id,
          desafiante_uid: desafio.desafiante_uid,
          proximo_desafio: Date.now() + 7 * 24 * 60 * 60 * 1000,
        });

        await updateDoc(ref, { status: "concluido" });
      } else {
        // conflito
        await updateDoc(ref, { status: "conflito" });
        await addDoc(collection(db, "alertas_conflito"), {
          desafio_id: desafio.id,
          ginasio_id: desafio.ginasio_id,
          lider_uid: desafio.lider_uid,
          desafiante_uid: desafio.desafiante_uid,
          createdAt: Date.now(),
        });
      }
    }

    // recarrega desafios
    const q1 = query(
      collection(db, "desafios_ginasio"),
      where("desafiante_uid", "==", userUid)
    );
    const snap1 = await getDocs(q1);
    const q2 = query(
      collection(db, "desafios_ginasio"),
      where("lider_uid", "==", userUid)
    );
    const snap2 = await getDocs(q2);
    const all: Desafio[] = [];
    [...snap1.docs, ...snap2.docs].forEach((d2) => {
      const data = d2.data() as any;
      all.push({
        id: d2.id,
        ginasio_id: data.ginasio_id,
        lider_uid: data.lider_uid,
        desafiante_uid: data.desafiante_uid,
        status: data.status,
        resultado_lider: data.resultado_lider ?? null,
        resultado_desafiante: data.resultado_desafiante ?? null,
        createdAt: data.createdAt,
      });
    });
    setDesafios(all);
  };

  const agora = Date.now();

  if (loading) return <p className="p-8">Carregando...</p>;

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold mb-4">Ginásios</h1>
      {ginasios.map((g) => {
        const meuDesafio = desafios.find(
          (d) =>
            d.ginasio_id === g.id &&
            (d.desafiante_uid === userUid || d.lider_uid === userUid) &&
            d.status === "pendente"
        );

        const meuBloqueio = bloqueios.find(
          (b) => b.ginasio_id === g.id && b.desafiante_uid === userUid
        );
        const bloqueado = meuBloqueio
          ? meuBloqueio.proximo_desafio > agora
          : false;

        const souLider = g.lider_uid === userUid;

        const disputaDoGinasio = disputas.find(
          (d) => d.ginasio_id === g.id && d.status === "inscricoes"
        );

        const jaNaDisputa = disputaDoGinasio
          ? participacoesDisputa.some(
              (p) => p.disputa_id === disputaDoGinasio.id
            )
          : false;

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
              <p className="text-sm text-gray-600">
                Tipo: {g.tipo ? g.tipo : "não definido"}
              </p>
              <p className="text-sm text-gray-600">
                Líder: {g.lider_uid ? liderNomes[g.lider_uid] || g.lider_uid : "vago"}
              </p>
            </div>

            <div className="flex flex-col gap-2 items-end">
              {g.em_disputa && !g.lider_uid && disputaDoGinasio ? (
                <>
                  {jaNaDisputa ? (
                    <span className="text-xs text-gray-500">
                      Você já está na disputa
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
                  <button
                    onClick={() => handleDeclarar(meuDesafio, "desafiante")}
                    className="px-3 py-1 bg-green-500 text-white rounded text-sm"
                  >
                    Eu ganhei
                  </button>
                  <button
                    onClick={() => handleDeclarar(meuDesafio, "lider")}
                    className="px-3 py-1 bg-red-500 text-white rounded text-sm"
                  >
                    {souLider ? "Desafiante perdeu" : "Líder ganhou"}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => handleDesafiar(g)}
                  disabled={bloqueado}
                  className="px-3 py-1 bg-yellow-500 text-white rounded text-sm disabled:opacity-50"
                >
                  Desafiar
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
