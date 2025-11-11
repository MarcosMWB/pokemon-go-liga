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

type Ginasio = {
  id: string;
  nome: string;
  tipo: string;
  lider_uid: string;
  em_disputa: boolean;
  liga?: string;
  liga_nome?: string;
};

type Disputa = {
  id: string;
  ginasio_id: string;
  status: "inscricoes" | "batalhando" | "finalizado";
};

type Liga = {
  id: string;
  nome: string;
};

export default function DevGinasiosPage() {
  const router = useRouter();
  const [userUid, setUserUid] = useState<string | null>(null);
  const [ginasios, setGinasios] = useState<Ginasio[]>([]);
  const [disputas, setDisputas] = useState<Disputa[]>([]);
  const [ligas, setLigas] = useState<Liga[]>([]);
  const [ligaSelecionada, setLigaSelecionada] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // checar admin
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }

      // só superuser
      const q = query(
        collection(db, "superusers"),
        where("uid", "==", user.uid)
      );
      const snap = await getDocs(q);
      if (snap.empty) {
        router.replace("/");
        return;
      }

      setUserUid(user.uid);
    });
    return () => unsub();
  }, [router]);

  // carregar ligas
  useEffect(() => {
    if (!userUid) return;
    (async () => {
      const snap = await getDocs(collection(db, "ligas"));
      const list: Liga[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          nome: data.nome || d.id,
        };
      });
      setLigas(list);
      if (list.length > 0) {
        setLigaSelecionada(list[0].nome);
      }
    })();
  }, [userUid]);

  // carregar dados
  useEffect(() => {
    if (!userUid) return;

    async function loadAll() {
      const gSnap = await getDocs(collection(db, "ginasios"));
      const gList: Ginasio[] = gSnap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          nome: data.nome,
          tipo: data.tipo || "",
          lider_uid: data.lider_uid || "",
          em_disputa: data.em_disputa || false,
          liga: data.liga || data.liga_nome || "",
          liga_nome: data.liga_nome || data.liga || "",
        };
      });

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

  const getDisputaDoGinasio = (gId: string) =>
    disputas.find((d) => d.ginasio_id === gId);

  const handleCriarDisputa = async (g: Ginasio) => {
    const ja = getDisputaDoGinasio(g.id);
    if (ja) return;

    const nova = await addDoc(collection(db, "disputas_ginasio"), {
      ginasio_id: g.id,
      status: "inscricoes",
      liga: g.liga || "",
      tipo_original: g.tipo || "",
      lider_anterior_uid: g.lider_uid || "",
      temporada_id: "",
      createdAt: Date.now(),
    });

    await updateDoc(doc(db, "ginasios", g.id), {
      em_disputa: true,
    });

    setDisputas((prev) => [
      ...prev,
      { id: nova.id, ginasio_id: g.id, status: "inscricoes" },
    ]);
    setGinasios((prev) =>
      prev.map((gg) =>
        gg.id === g.id ? { ...gg, em_disputa: true } : gg
      )
    );
  };

  const handleIniciarDisputa = async (g: Ginasio) => {
    const disputa = getDisputaDoGinasio(g.id);
    if (!disputa) return;
    if (disputa.status !== "inscricoes") return;

    // remove quem não escolheu tipo
    const partSnap = await getDocs(
      query(
        collection(db, "disputas_ginasio_participantes"),
        where("disputa_id", "==", disputa.id)
      )
    );

    for (const pDoc of partSnap.docs) {
      const d = pDoc.data() as any;
      if (!d.tipo_escolhido || d.tipo_escolhido === "") {
        await updateDoc(pDoc.ref, {
          removido: true,
        });
      }
    }

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

    const partSnap = await getDocs(
      query(
        collection(db, "disputas_ginasio_participantes"),
        where("disputa_id", "==", disputa.id),
        where("removido", "==", false)
      )
    ).catch(async () => {
      // caso não tenha o campo removido
      const p2 = await getDocs(
        query(
          collection(db, "disputas_ginasio_participantes"),
          where("disputa_id", "==", disputa.id)
        )
      );
      return p2;
    });

    const participantes = partSnap.docs.map((p) => {
      const d = p.data() as any;
      return {
        usuario_uid: d.usuario_uid as string,
        tipo_escolhido: d.tipo_escolhido as string,
      };
    });

    const resSnap = await getDocs(
      query(
        collection(db, "disputas_ginasio_resultados"),
        where("disputa_id", "==", disputa.id),
        where("status", "!=", "contestado")
      )
    ).catch(async () => {
      const r2 = await getDocs(
        query(
          collection(db, "disputas_ginasio_resultados"),
          where("disputa_id", "==", disputa.id)
        )
      );
      return r2;
    });

    const resultados = resSnap.docs.map((r) => {
      const d = r.data() as any;
      return {
        vencedor_uid: d.vencedor_uid as string | undefined,
        perdedor_uid: d.perdedor_uid as string | undefined,
        tipo: d.tipo as string | undefined,
        jogador1_uid: d.jogador1_uid as string | undefined,
        jogador2_uid: d.jogador2_uid as string | undefined,
        status: d.status as string | undefined,
      };
    });

    // somar pontos
    const pontos: Record<string, number> = {};
    participantes.forEach((p) => {
      pontos[p.usuario_uid] = 0;
    });
    resultados.forEach((r) => {
      if (r.status && r.status !== "confirmado") return;
      if (r.tipo === "empate") {
        if (r.jogador1_uid) pontos[r.jogador1_uid] = (pontos[r.jogador1_uid] || 0) + 1;
        if (r.jogador2_uid) pontos[r.jogador2_uid] = (pontos[r.jogador2_uid] || 0) + 1;
      } else if (r.vencedor_uid) {
        pontos[r.vencedor_uid] = (pontos[r.vencedor_uid] || 0) + 3;
      }
    });

    // descobrir maior pontuação
    let maior = -1;
    for (const uid in pontos) {
      if (pontos[uid] > maior) maior = pontos[uid];
    }
    const empatados = Object.keys(pontos).filter((uid) => pontos[uid] === maior);

    if (empatados.length === 1) {
      // temos campeão
      const vencedorUid = empatados[0];
      const participanteVencedor = participantes.find(
        (p) => p.usuario_uid === vencedorUid
      );

      await updateDoc(doc(db, "disputas_ginasio", disputa.id), {
        status: "finalizado",
        encerradaEm: Date.now(),
        vencedor_uid: vencedorUid,
      });

      await updateDoc(doc(db, "ginasios", g.id), {
        lider_uid: vencedorUid,
        tipo: participanteVencedor?.tipo_escolhido || g.tipo || "",
        em_disputa: false,
      });

      setDisputas((prev) => prev.filter((d) => d.id !== disputa.id));
      setGinasios((prev) =>
        prev.map((gg) =>
          gg.id === g.id ? { ...gg, em_disputa: false, lider_uid: vencedorUid } : gg
        )
      );
    } else {
      // deu empate -> criar nova disputa SÓ com empatados
      await updateDoc(doc(db, "disputas_ginasio", disputa.id), {
        status: "finalizado",
        encerradaEm: Date.now(),
        vencedor_uid: "",
        empate: true,
      });

      const nova = await addDoc(collection(db, "disputas_ginasio"), {
        ginasio_id: g.id,
        status: "inscricoes",
        liga: g.liga || "",
        tipo_original: g.tipo || "",
        lider_anterior_uid: g.lider_uid || "",
        temporada_id: "",
        createdAt: Date.now(),
        motivo: "desempate",
      });

      // reinsere apenas os empatados
      for (const uid of empatados) {
        const partOrig = participantes.find((p) => p.usuario_uid === uid);
        await addDoc(collection(db, "disputas_ginasio_participantes"), {
          disputa_id: nova.id,
          ginasio_id: g.id,
          usuario_uid: uid,
          tipo_escolhido: partOrig?.tipo_escolhido || "",
          createdAt: Date.now(),
        });
      }

      // mantém ginásio em disputa
      await updateDoc(doc(db, "ginasios", g.id), {
        em_disputa: true,
      });

      // atualiza tela
      setDisputas((prev) =>
        prev
          .filter((d) => d.id !== disputa.id)
          .concat([{ id: nova.id, ginasio_id: g.id, status: "inscricoes" }])
      );
    }
  };

  if (loading) return <p className="p-8">Carregando...</p>;

  const ginasiosFiltrados = ginasios.filter((g) => {
    if (!ligaSelecionada) return true;
    const nomeLigaDoGinasio = g.liga_nome || g.liga || "";
    return nomeLigaDoGinasio === ligaSelecionada;
  });

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">DEV / Ginásios</h1>
          <p className="text-sm text-gray-500">
            Aqui você força abrir/começar/encerrar disputas.
          </p>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">
            Filtrar por liga
          </label>
          <select
            value={ligaSelecionada}
            onChange={(e) => setLigaSelecionada(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="">Todas</option>
            {ligas.map((l) => (
              <option key={l.id} value={l.nome}>
                {l.nome}
              </option>
            ))}
          </select>
        </div>
      </div>

      {ginasiosFiltrados.map((g) => {
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
                Liga: {g.liga_nome || g.liga || "Sem liga"}
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
