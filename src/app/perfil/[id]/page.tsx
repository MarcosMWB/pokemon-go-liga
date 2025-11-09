"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  getDoc,
  updateDoc,
  addDoc,
} from "firebase/firestore";

type Usuario = {
  id: string;
  nome?: string;
  email?: string;
  friend_code?: string;
};

type Ginasio = {
  id: string;
  nome: string;
  tipo: string;
  lider_uid: string;
  derrotas_seguidas?: number;
  em_disputa?: boolean;
};

type DisputaParticipante = {
  id: string;
  disputa_id: string;
  ginasio_id: string;
  tipo_escolhido?: string;
  ginasio_nome?: string;
  disputa_status?: string;
};

type Desafio = {
  id: string;
  ginasio_id: string;
  lider_uid: string;
  desafiante_uid: string;
  status: string;
  criadoEm?: number;
  desafiante_nome?: string;
};

export default function PerfilPage() {
  const params = useParams();
  const router = useRouter();
  const perfilUid = params?.id as string;

  const [logadoUid, setLogadoUid] = useState<string | null>(null);
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [ginasiosLider, setGinasiosLider] = useState<Ginasio[]>([]);
  const [minhasInscricoes, setMinhasInscricoes] = useState<DisputaParticipante[]>([]);
  const [desafiosComoLider, setDesafiosComoLider] = useState<Desafio[]>([]);
  const [loading, setLoading] = useState(true);

  // quem está logado
  useEffect(() => {
    const unsub = auth.onAuthStateChanged((user) => {
      if (user) setLogadoUid(user.uid);
    });
    return () => unsub();
  }, []);

  // dados do usuário do perfil
  useEffect(() => {
    if (!perfilUid) return;
    (async () => {
      const uSnap = await getDoc(doc(db, "usuarios", perfilUid));
      if (uSnap.exists()) {
        const d = uSnap.data() as any;
        setUsuario({
          id: perfilUid,
          nome: d.nome,
          email: d.email,
          friend_code: d.friend_code,
        });
      } else {
        setUsuario({ id: perfilUid });
      }
      setLoading(false);
    })();
  }, [perfilUid]);

  // ginásios que ele lidera
  useEffect(() => {
    if (!perfilUid) return;
    const qG = query(collection(db, "ginasios"), where("lider_uid", "==", perfilUid));
    const unsub = onSnapshot(qG, (snap) => {
      const list: Ginasio[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          nome: data.nome,
          tipo: data.tipo || "",
          lider_uid: data.lider_uid,
          derrotas_seguidas: data.derrotas_seguidas ?? 0,
          em_disputa: data.em_disputa ?? false,
        };
      });
      setGinasiosLider(list);
    });
    return () => unsub();
  }, [perfilUid]);

  // disputas que ele participa
  useEffect(() => {
  if (!perfilUid) return;

  const qP = query(
    collection(db, "disputas_ginasio_participantes"),
    where("usuario_uid", "==", perfilUid)
  );

  const unsub = onSnapshot(qP, async (snap) => {
    const enriched: DisputaParticipante[] = [];

    for (const docPart of snap.docs) {
      const data = docPart.data() as any;
      const disputaId = data.disputa_id;
      const ginasioId = data.ginasio_id;

      // pega disputa
      const dSnap = await getDoc(doc(db, "disputas_ginasio", disputaId));
      if (!dSnap.exists()) {
        // disputa apagada → não mostra
        continue;
      }
      const dData = dSnap.data() as any;

      // pula disputas finalizadas
      if (dData.status === "finalizado") {
        continue;
      }

      // pega ginásio
      let ginasio_nome: string | undefined = undefined;
      const gSnap = await getDoc(doc(db, "ginasios", ginasioId));
      if (gSnap.exists()) {
        const gData = gSnap.data() as any;
        ginasio_nome = gData.nome;
      }

      enriched.push({
        id: docPart.id,
        disputa_id: disputaId,
        ginasio_id: ginasioId,
        tipo_escolhido: data.tipo_escolhido,
        ginasio_nome,
        disputa_status: dData.status,
      });
    }

    setMinhasInscricoes(enriched);
  });

  return () => unsub();
}, [perfilUid]);

  // desafios que ele precisa confirmar (como líder)
  useEffect(() => {
    if (!perfilUid) return;

    const qD = query(
      collection(db, "desafios_ginasio"),
      where("lider_uid", "==", perfilUid),
      where("status", "==", "pendente")
    );

    const unsub = onSnapshot(qD, async (snap) => {
      const list: Desafio[] = [];
      for (const d of snap.docs) {
        const data = d.data() as any;
        let desafiante_nome: string | undefined = undefined;
        const uSnap = await getDoc(doc(db, "usuarios", data.desafiante_uid));
        if (uSnap.exists()) {
          const u = uSnap.data() as any;
          desafiante_nome = u.nome || u.email;
        }
        list.push({
          id: d.id,
          ginasio_id: data.ginasio_id,
          lider_uid: data.lider_uid,
          desafiante_uid: data.desafiante_uid,
          status: data.status,
          criadoEm: data.criadoEm,
          desafiante_nome,
        });
      }
      setDesafiosComoLider(list);
    });

    return () => unsub();
  }, [perfilUid]);

  const ehMeuPerfil = logadoUid === perfilUid;

  // líder disse que ganhou
  const handleLiderGanhou = async (desafio: Desafio) => {
    if (!ehMeuPerfil) return;
    await updateDoc(doc(db, "desafios_ginasio", desafio.id), {
      status: "lider_ganhou",
      confirmado_por_lider: perfilUid,
      confirmadoEm: Date.now(),
    });
  };

  // líder disse que desafiante ganhou
  const handleDesafianteGanhou = async (desafio: Desafio) => {
    if (!ehMeuPerfil) return;

    await updateDoc(doc(db, "desafios_ginasio", desafio.id), {
      status: "desafiante_ganhou",
      confirmado_por_lider: perfilUid,
      confirmadoEm: Date.now(),
    });

    const gRef = doc(db, "ginasios", desafio.ginasio_id);
    const gSnap = await getDoc(gRef);
    if (!gSnap.exists()) return;
    const gData = gSnap.data() as any;
    let derrotas = gData.derrotas_seguidas ?? 0;
    derrotas += 1;

    if (derrotas >= 3) {
      await addDoc(collection(db, "disputas_ginasio"), {
        ginasio_id: desafio.ginasio_id,
        status: "inscricoes",
        tipo_original: gData.tipo || "",
        lider_anterior_uid: gData.lider_uid || "",
        createdAt: Date.now(),
      });

      await updateDoc(gRef, {
        lider_uid: "",
        em_disputa: true,
        derrotas_seguidas: 0,
      });
    } else {
      await updateDoc(gRef, {
        derrotas_seguidas: derrotas,
      });
    }
  };

  // renunciar
  const handleRenunciar = async (g: Ginasio) => {
    if (!ehMeuPerfil) return;

    await addDoc(collection(db, "disputas_ginasio"), {
      ginasio_id: g.id,
      status: "inscricoes",
      tipo_original: g.tipo || "",
      lider_anterior_uid: g.lider_uid || "",
      createdAt: Date.now(),
    });

    await updateDoc(doc(db, "ginasios", g.id), {
      lider_uid: "",
      em_disputa: true,
      derrotas_seguidas: 0,
    });
  };

  if (loading) return <p className="p-6">Carregando...</p>;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Cabeçalho */}
      <div className="bg-white p-4 rounded shadow">
        <h1 className="text-2xl font-bold">
          {usuario?.nome || usuario?.email || "Jogador"}
        </h1>
        <p className="text-sm text-gray-500">UID: {perfilUid}</p>
        {usuario?.friend_code && (
          <p className="text-sm mt-1">Friend code: {usuario.friend_code}</p>
        )}
        <button
  onClick={() => router.push(`/equipes/${perfilUid}`)}
  className="bg-purple-600 text-white px-3 py-2 rounded text-sm"
>
  Ver minhas equipes
</button>

      </div>

      {/* área de líder */}
      {ehMeuPerfil && (
        <>
          <div className="space-y-3">
            <h2 className="text-xl font-semibold">Seus ginásios</h2>
            {ginasiosLider.length === 0 ? (
              <p className="text-sm text-gray-500">
                Você não é líder de nenhum ginásio.
              </p>
            ) : (
              ginasiosLider.map((g) => (
                <div
                  key={g.id}
                  className="bg-white p-4 rounded shadow flex justify-between items-center"
                >
                  <div>
                    <p className="font-semibold">{g.nome}</p>
                    <p className="text-sm text-gray-500">
                      Tipo: {g.tipo || "não definido"}
                    </p>
                    <p className="text-xs text-gray-400">
                      Derrotas seguidas: {g.derrotas_seguidas ?? 0} / 3
                    </p>
                    {g.em_disputa && (
                      <p className="text-xs text-red-500">Em disputa</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleRenunciar(g)}
                    className="bg-red-500 text-white px-3 py-1 rounded text-sm"
                  >
                    Renunciar
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="bg-white p-4 rounded shadow">
            <h2 className="text-lg font-semibold mb-2">
              Desafios pendentes para você
            </h2>
            {desafiosComoLider.length === 0 ? (
              <p className="text-sm text-gray-500">Nenhum desafio pendente.</p>
            ) : (
              <div className="space-y-2">
                {desafiosComoLider.map((d) => {
                  const g = ginasiosLider.find((g) => g.id === d.ginasio_id);
                  return (
                    <div
                      key={d.id}
                      className="flex justify-between items-center bg-gray-50 px-3 py-2 rounded"
                    >
                      <div>
                        <p className="text-sm">
                          {d.desafiante_nome || d.desafiante_uid} desafiou{" "}
                          {g?.nome || d.ginasio_id}
                        </p>
                        <p className="text-xs text-gray-400">
                          ID desafio: {d.id}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleLiderGanhou(d)}
                          className="bg-green-600 text-white px-2 py-1 rounded text-xs"
                        >
                          Eu ganhei
                        </button>
                        <button
                          onClick={() => handleDesafianteGanhou(d)}
                          className="bg-yellow-500 text-white px-2 py-1 rounded text-xs"
                        >
                          Ele ganhou
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* disputas que participa */}
      <div className="bg-white p-4 rounded shadow">
        <h2 className="text-lg font-semibold mb-2">Disputas que participa</h2>
        {minhasInscricoes.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhuma disputa encontrada.</p>
        ) : (
          <ul className="space-y-2">
            {minhasInscricoes.map((p) => (
              <li
                key={p.id}
                className="flex justify-between items-center bg-gray-50 px-3 py-2 rounded"
              >
                <div>
                  <p className="text-sm font-medium">
                    {p.ginasio_nome || p.ginasio_id}
                  </p>
                  <p className="text-xs text-gray-500">
                    Status: {p.disputa_status}
                  </p>
                  {p.tipo_escolhido && (
                    <p className="text-xs text-gray-500">
                      Tipo: {p.tipo_escolhido}
                    </p>
                  )}
                </div>
                <button
					onClick={() => router.push(`/ginasios/${p.ginasio_id}/disputa`)}
                  className="bg-blue-600 text-white px-3 py-1 rounded text-sm"
                >
                  Abrir
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* placeholders */}
      <div className="bg-white p-4 rounded shadow">
        <h2 className="text-lg font-semibold mb-2">Insígnias</h2>
        <p className="text-sm text-gray-500">
          Aqui vão as insígnias conquistadas (quando você criar a coleção).
        </p>
      </div>

      <div className="bg-white p-4 rounded shadow">
        <h2 className="text-lg font-semibold mb-2">Histórico de campeonatos</h2>
        <p className="text-sm text-gray-500">
          Aqui vão campeonatos, hall da fama, títulos.
        </p>
      </div>

      <button
        onClick={() => router.push("/")}
        className="bg-gray-200 text-gray-800 px-3 py-2 rounded text-sm"
      >
        Voltar
      </button>
    </div>
  );
}
