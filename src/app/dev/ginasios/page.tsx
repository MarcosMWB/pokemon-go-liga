"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  getDocs,
  query,
  where,
  addDoc,
  updateDoc,
  doc,
} from "firebase/firestore";

const ADMIN_UID = "SEU_UID_AQUI"; // <<< TROCAR

type Ginasio = {
  id: string;
  nome: string;
  tipo: string;
  lider_uid: string;
  em_disputa: boolean;
};

type Disputa = {
  id: string;
  ginasio_id: string;
  status: "inscricoes" | "batalhando" | "finalizado";
};

export default function DevGinasiosPage() {
  const router = useRouter();
  const [userUid, setUserUid] = useState<string | null>(null);
  const [ginasios, setGinasios] = useState<Ginasio[]>([]);
  const [disputas, setDisputas] = useState<Disputa[]>([]);
  const [loading, setLoading] = useState(true);

  // auth
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

  // carregar dados
  useEffect(() => {
    if (!userUid) return;

    async function loadAll() {
      // ginasios
      const gSnap = await getDocs(collection(db, "ginasios"));
      const gList: Ginasio[] = gSnap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          nome: data.nome,
          tipo: data.tipo || "",
          lider_uid: data.lider_uid || "",
          em_disputa: data.em_disputa || false,
        };
      });

      // disputas abertas ou em andamento
      const dSnap = await getDocs(
        query(
          collection(db, "disputas_ginasio"),
          where("status", "in", ["inscricoes", "batalhando"])
        )
      );
      const dList: Disputa[] = dSnap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          ginasio_id: data.ginasio_id,
          status: data.status,
        };
      });

      setGinasios(gList);
      setDisputas(dList);
      setLoading(false);
    }

    loadAll();
  }, [userUid]);

  // se não for admin, bloqueia
  /*if (userUid && userUid !== ADMIN_UID) {
    return <p className="p-8 text-red-500">Acesso negado.</p>;
  }*/

  const getDisputaDoGinasio = (gId: string) =>
    disputas.find((d) => d.ginasio_id === gId);

  const handleCriarDisputa = async (g: Ginasio) => {
    // só cria se não tem
    const ja = getDisputaDoGinasio(g.id);
    if (ja) return;

    const nova = await addDoc(collection(db, "disputas_ginasio"), {
      ginasio_id: g.id,
      status: "inscricoes",
      tipo_original: g.tipo || "",
      lider_anterior_uid: g.lider_uid || "",
      temporada_id: "",
      createdAt: Date.now(),
    });

    // marca ginásio
    await updateDoc(doc(db, "ginasios", g.id), {
      em_disputa: true,
    });

    // atualiza lista local
    setDisputas((prev) => [
      ...prev,
      { id: nova.id, ginasio_id: g.id, status: "inscricoes" },
    ]);
  };

  const handleIniciarDisputa = async (g: Ginasio) => {
    const disputa = getDisputaDoGinasio(g.id);
    if (!disputa) return;
    if (disputa.status !== "inscricoes") return;

    // pega participantes
    const partSnap = await getDocs(
      query(
        collection(db, "disputas_ginasio_participantes"),
        where("disputa_id", "==", disputa.id)
      )
    );

    // exclui quem não tem tipo
    for (const pDoc of partSnap.docs) {
      const d = pDoc.data() as any;
      if (!d.tipo_escolhido || d.tipo_escolhido === "") {
        // remove da disputa
        await updateDoc(pDoc.ref, {
          removido: true,
        });
        // se quiser realmente apagar:
        // await deleteDoc(pDoc.ref)
      }
    }

    // agora inicia
    await updateDoc(doc(db, "disputas_ginasio", disputa.id), {
      status: "batalhando",
      iniciadaEm: Date.now(),
    });

    setDisputas((prev) =>
      prev.map((d) =>
        d.id === disputa.id ? { ...d, status: "batalhando" } : d
      )
    );
  };

  const handleEncerrarDisputa = async (g: Ginasio) => {
    const disputa = getDisputaDoGinasio(g.id);
    if (!disputa) return;

    // 1. pegar participantes dessa disputa
    const partSnap = await getDocs(
      query(
        collection(db, "disputas_ginasio_participantes"),
        where("disputa_id", "==", disputa.id)
      )
    );
    const participantes = partSnap.docs.map((p) => {
      const d = p.data() as any;
      return {
        usuario_uid: d.usuario_uid as string,
        tipo_escolhido: d.tipo_escolhido as string,
      };
    });

    // 2. pegar resultados dessa disputa
    const resSnap = await getDocs(
      query(
        collection(db, "disputas_ginasio_resultados"),
        where("disputa_id", "==", disputa.id)
      )
    );
    const resultados = resSnap.docs.map((r) => {
      const d = r.data() as any;
      return {
        vencedor_uid: d.vencedor_uid as string,
        perdedor_uid: d.perdedor_uid as string,
      };
    });

    // 3. somar pontos
    const pontos: Record<string, number> = {};
    participantes.forEach((p) => {
      pontos[p.usuario_uid] = 0;
    });
    resultados.forEach((r) => {
      if (pontos[r.vencedor_uid] === undefined) {
        pontos[r.vencedor_uid] = 0;
      }
      pontos[r.vencedor_uid] += 3;
    });

    // 4. descobrir vencedor
    let vencedorUid: string | null = null;
    let maior = -1;
    for (const uid in pontos) {
      if (pontos[uid] > maior) {
        maior = pontos[uid];
        vencedorUid = uid;
      }
    }

    // 5. atualizar disputa e ginásio
    await updateDoc(doc(db, "disputas_ginasio", disputa.id), {
      status: "finalizado",
      encerradaEm: Date.now(),
      vencedor_uid: vencedorUid || "",
    });

    // se tem vencedor, atualiza o ginásio
    if (vencedorUid) {
      const participanteVencedor = participantes.find(
        (p) => p.usuario_uid === vencedorUid
      );
      await updateDoc(doc(db, "ginasios", g.id), {
        lider_uid: vencedorUid,
        tipo: participanteVencedor?.tipo_escolhido || g.tipo || "",
        em_disputa: false,
      });
    } else {
      // sem vencedor, só tira disputa
      await updateDoc(doc(db, "ginasios", g.id), {
        em_disputa: false,
      });
    }

    // 6. tirar da tela local
    setDisputas((prev) => prev.filter((d) => d.id !== disputa.id));
    setGinasios((prev) =>
      prev.map((gg) =>
        gg.id === g.id ? { ...gg, em_disputa: false } : gg
      )
    );

    // encerra disputa
    await updateDoc(doc(db, "disputas_ginasio", disputa.id), {
      status: "finalizado",
      encerradaEm: Date.now(),
    });

    // desmarca ginásio
    await updateDoc(doc(db, "ginasios", g.id), {
      em_disputa: false,
    });

    // tira da lista local
    setDisputas((prev) => prev.filter((d) => d.id !== disputa.id));
    setGinasios((prev) =>
      prev.map((gg) =>
        gg.id === g.id ? { ...gg, em_disputa: false } : gg
      )
    );
  };

  if (loading) return <p className="p-8">Carregando...</p>;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold mb-4">DEV / Ginásios</h1>
      <p className="text-sm text-gray-500 mb-4">
        Aqui você força abrir/começar/encerrar disputas.
      </p>

      {ginasios.map((g) => {
        const disputa = getDisputaDoGinasio(g.id);
        return (
          <div
            key={g.id}
            className="border rounded p-4 flex justify-between items-center bg-white"
          >
            <div>
              <h2 className="font-semibold">
                {g.nome}{" "}
                {g.em_disputa && (
                  <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded ml-2">
                    em disputa
                  </span>
                )}
              </h2>
              <p className="text-sm text-gray-600">
                Líder: {g.lider_uid ? g.lider_uid : "vago"}
              </p>
              <p className="text-xs text-gray-500">
                Disputa: {disputa ? disputa.status : "nenhuma"}
              </p>
              <a
                href={`/ginasios/${g.id}/disputa`}
                className="text-xs text-blue-600 underline"
              >
                Ver página da disputa
              </a>
            </div>
            <div className="flex gap-2">
              {!disputa && (
                <button
                  onClick={() => handleCriarDisputa(g)}
                  className="bg-purple-500 text-white px-3 py-1 rounded text-sm"
                >
                  Criar disputa
                </button>
              )}
              {disputa && disputa.status === "inscricoes" && (
                <button
                  onClick={() => handleIniciarDisputa(g)}
                  className="bg-orange-500 text-white px-3 py-1 rounded text-sm"
                >
                  Iniciar disputa
                </button>
              )}
              {disputa && (
                <button
                  onClick={() => handleEncerrarDisputa(g)}
                  className="bg-gray-400 text-white px-3 py-1 rounded text-sm"
                >
                  Encerrar disputa
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
