"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { TYPE_ICONS } from "@/utils/typeIcons";
import Image from "next/image";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  updateDoc,
  addDoc,
} from "firebase/firestore";

const TIPOS = [
  "normal",
  "fire",
  "water",
  "grass",
  "electric",
  "ice",
  "fighting",
  "poison",
  "ground",
  "flying",
  "psychic",
  "bug",
  "rock",
  "ghost",
  "dragon",
  "dark",
  "steel",
  "fairy",
];

type Ginasio = {
  id: string;
  nome: string;
  tipo: string;
  lider_uid?: string;
};

type Disputa = {
  id: string;
  ginasio_id: string;
  status: "inscricoes" | "batalhando" | "finalizado";
  tipo_original: string;
};

type Participante = {
  id: string;
  usuario_uid: string;
  tipo_escolhido: string;
  nome?: string;
  email?: string;
};

type Resultado = {
  id: string;
  disputa_id: string;
  vencedor_uid?: string;
  perdedor_uid?: string;
  tipo?: "empate";
  jogador1_uid?: string;
  jogador2_uid?: string;
  declarado_por: string;
  status: "pendente" | "confirmado" | "contestado";
  createdAt: number;
};

export default function DisputaGinasioPage() {
  const params = useParams();
  const router = useRouter();
  const ginasioId = params?.id as string;

  const [userUid, setUserUid] = useState<string | null>(null);
  const [ginasio, setGinasio] = useState<Ginasio | null>(null);
  const [disputa, setDisputa] = useState<Disputa | null>(null);
  const [participantes, setParticipantes] = useState<Participante[]>([]);
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [ocupados, setOcupados] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [salvandoTipo, setSalvandoTipo] = useState(false);
  const [declarando, setDeclarando] = useState(false);
  const [oponente, setOponente] = useState("");

  // helper pra renderizar ícone
  const renderTipoIcon = (tipo?: string, size = 28) => {
    if (!tipo) return null;
    const src = TYPE_ICONS[tipo];
    if (!src) return <span className="text-xs text-gray-500">{tipo}</span>;
    return (
      <Image src={src} alt={tipo} width={size} height={size} className="inline-block" />
    );
  };

  // 1) auth
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

  // 2) ouvir ginásio + disputa
  useEffect(() => {
    if (!ginasioId) return;

    // ginásio
    const unsubG = onSnapshot(doc(db, "ginasios", ginasioId), (snap) => {
      if (!snap.exists()) return;
      const d = snap.data() as any;
      setGinasio({
        id: snap.id,
        nome: d.nome,
        tipo: d.tipo || "",
        lider_uid: d.lider_uid || "",
      });
    });

    // disputa do ginásio
    const qDisputa = query(
      collection(db, "disputas_ginasio"),
      where("ginasio_id", "==", ginasioId),
      where("status", "in", ["inscricoes", "batalhando"])
    );
    const unsubD = onSnapshot(qDisputa, (snap) => {
      if (snap.empty) {
        setDisputa(null);
        setLoading(false);
        return;
      }
      const dDoc = snap.docs[0];
      const dData = dDoc.data() as any;
      setDisputa({
        id: dDoc.id,
        ginasio_id: dData.ginasio_id,
        status: dData.status,
        tipo_original: dData.tipo_original || "",
      });
      setLoading(false);
    });

    return () => {
      unsubG();
      unsubD();
    };
  }, [ginasioId]);

  // 3) ouvir participantes da disputa
  useEffect(() => {
    if (!disputa) return;

    const qPart = query(
      collection(db, "disputas_ginasio_participantes"),
      where("disputa_id", "==", disputa.id)
    );

    const unsub = onSnapshot(qPart, async (snap) => {
      const base = snap.docs
        .map((p) => {
          const d = p.data() as any;
          return {
            id: p.id,
            usuario_uid: d.usuario_uid,
            tipo_escolhido: d.tipo_escolhido || "",
            removido: d.removido === true,
          };
        })
        .filter((p) => !p.removido);

      const withNames: Participante[] = [];
      for (const p of base) {
        const uSnap = await getDoc(doc(db, "usuarios", p.usuario_uid));
        if (uSnap.exists()) {
          const u = uSnap.data() as any;
          withNames.push({
            id: p.id,
            usuario_uid: p.usuario_uid,
            tipo_escolhido: p.tipo_escolhido,
            nome: u.nome,
            email: u.email,
          });
        } else {
          withNames.push({
            id: p.id,
            usuario_uid: p.usuario_uid,
            tipo_escolhido: p.tipo_escolhido,
          });
        }
      }
      setParticipantes(withNames);
    });

    return () => unsub();
  }, [disputa]);

  // 4) ouvir resultados da disputa
  useEffect(() => {
    if (!disputa) return;

    const qRes = query(
      collection(db, "disputas_ginasio_resultados"),
      where("disputa_id", "==", disputa.id)
    );

    const unsub = onSnapshot(qRes, (snap) => {
      const list = snap.docs.map((r) => {
        const d = r.data() as any;
        return {
          id: r.id,
          disputa_id: d.disputa_id,
          vencedor_uid: d.vencedor_uid,
          perdedor_uid: d.perdedor_uid,
          tipo: d.tipo,
          jogador1_uid: d.jogador1_uid,
          jogador2_uid: d.jogador2_uid,
          declarado_por: d.declarado_por,
          status: d.status || "pendente",
          createdAt: d.createdAt,
        } as Resultado;
      });
      setResultados(list);
    });

    return () => unsub();
  }, [disputa]);

  // 5) carregar tipos ocupados
  useEffect(() => {
    if (!ginasioId) return;
    (async () => {
      const all = await getDocs(collection(db, "ginasios"));
      const v: string[] = [];
      all.forEach((g) => {
        const d = g.data() as any;
        if (g.id === ginasioId) return;
        if (d.tipo) v.push(d.tipo);
      });
      setOcupados(v);
    })();
  }, [ginasioId]);

  const disputaTravada = disputa?.status === "batalhando";

  const existeResultadoEntre = (a: string, b: string): boolean => {
    return resultados.some((r) => {
      if (r.status === "contestado") return false;
      if (r.tipo === "empate") {
        return (
          (r.jogador1_uid === a && r.jogador2_uid === b) ||
          (r.jogador1_uid === b && r.jogador2_uid === a)
        );
      }
      return (
        (r.vencedor_uid === a && r.perdedor_uid === b) ||
        (r.vencedor_uid === b && r.perdedor_uid === a)
      );
    });
  };

  const handleEscolherTipo = async (tipo: string) => {
    if (!userUid || !disputa) return;
    if (disputaTravada) return;
    setSalvandoTipo(true);

    const q = query(
      collection(db, "disputas_ginasio_participantes"),
      where("disputa_id", "==", disputa.id),
      where("usuario_uid", "==", userUid)
    );
    const snap = await getDocs(q);
    if (snap.empty) {
      await addDoc(collection(db, "disputas_ginasio_participantes"), {
        disputa_id: disputa.id,
        ginasio_id: disputa.ginasio_id,
        usuario_uid: userUid,
        tipo_escolhido: tipo,
        createdAt: Date.now(),
      });
    } else {
      await updateDoc(snap.docs[0].ref, {
        tipo_escolhido: tipo,
      });
    }

    setSalvandoTipo(false);
  };

  const handleDeclararVitoria = async () => {
    if (!userUid || !disputa) return;
    if (!oponente) return;
    const me = participantes.find((p) => p.usuario_uid === userUid);
    if (!me?.tipo_escolhido) {
      alert("Escolha seu tipo antes.");
      return;
    }
    if (existeResultadoEntre(userUid, oponente)) {
      alert("Já existe resultado entre vocês dois.");
      return;
    }
    setDeclarando(true);
    await addDoc(collection(db, "disputas_ginasio_resultados"), {
      disputa_id: disputa.id,
      ginasio_id: disputa.ginasio_id,
      vencedor_uid: userUid,
      perdedor_uid: oponente,
      declarado_por: userUid,
      status: "pendente",
      createdAt: Date.now(),
    });
    setDeclarando(false);
  };

  const handleDeclararEmpate = async () => {
    if (!userUid || !disputa) return;
    if (!oponente) return;
    const me = participantes.find((p) => p.usuario_uid === userUid);
    if (!me?.tipo_escolhido) {
      alert("Escolha seu tipo antes.");
      return;
    }
    if (existeResultadoEntre(userUid, oponente)) {
      alert("Já existe resultado entre vocês dois.");
      return;
    }
    setDeclarando(true);
    await addDoc(collection(db, "disputas_ginasio_resultados"), {
      disputa_id: disputa.id,
      ginasio_id: disputa.ginasio_id,
      tipo: "empate",
      jogador1_uid: userUid,
      jogador2_uid: oponente,
      declarado_por: userUid,
      status: "pendente",
      createdAt: Date.now(),
    });
    setDeclarando(false);
  };

  const handleConfirmarResultado = async (
    res: Resultado,
    novoStatus: "confirmado" | "contestado"
  ) => {
    await updateDoc(doc(db, "disputas_ginasio_resultados", res.id), {
      status: novoStatus,
      atualizadoEm: Date.now(),
    });
  };

  if (loading) return <p className="p-8">Carregando disputa...</p>;
  if (!ginasio) return <p className="p-8">Ginásio não encontrado.</p>;
  if (!disputa) {
    return (
      <div className="p-8">
        <p className="mb-4">Nenhuma disputa aberta para este ginásio.</p>
        <button
          onClick={() => router.push("/ginasios")}
          className="bg-blue-600 text-white px-4 py-2 rounded"
        >
          Voltar
        </button>
      </div>
    );
  }

  const tiposPermitidos = TIPOS.filter((t) => {
    if (t === disputa.tipo_original) return true;
    return !ocupados.includes(t);
  });

  const meuParticipante = userUid
    ? participantes.find((p) => p.usuario_uid === userUid)
    : null;

  const pendentesParaMim =
    userUid
      ? resultados.filter((r) => {
          if (r.status !== "pendente") return false;
          if (r.declarado_por === userUid) return false;

          if (r.tipo === "empate") {
            return r.jogador1_uid === userUid || r.jogador2_uid === userUid;
          }

          return r.perdedor_uid === userUid;
        })
      : [];

  const pontos: Record<string, number> = {};
  participantes.forEach((p) => {
    pontos[p.usuario_uid] = 0;
  });
  resultados.forEach((r) => {
    if (r.status !== "confirmado") return;
    if (r.tipo === "empate") {
      if (r.jogador1_uid) pontos[r.jogador1_uid] += 1;
      if (r.jogador2_uid) pontos[r.jogador2_uid] += 1;
    } else {
      if (r.vencedor_uid) pontos[r.vencedor_uid] += 3;
    }
  });
  const ranking = [...participantes].sort((a, b) => {
    const pa = pontos[a.usuario_uid] || 0;
    const pb = pontos[b.usuario_uid] || 0;
    return pb - pa;
  });

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">Disputa do ginásio {ginasio.nome}</h1>

      {!ginasio.lider_uid && (
        <p className="text-sm bg-yellow-100 text-yellow-800 px-3 py-2 rounded">
          Ginásio sem líder. Quem tiver mais pontos quando o admin encerrar fica com a vaga.
        </p>
      )}

      <p className="text-gray-600">
        Status: {disputa.status === "inscricoes" ? "inscrições abertas" : disputa.status}
      </p>

      {/* escolher tipo */}
      <div className="bg-white border rounded p-4">
        <h2 className="font-semibold mb-2">Seu tipo na disputa</h2>
        {disputaTravada && (
          <p className="text-xs text-red-500 mb-2">
            Disputa iniciada. Não dá mais pra trocar.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {tiposPermitidos.map((t) => (
            <button
              key={t}
              onClick={() => handleEscolherTipo(t)}
              disabled={salvandoTipo || disputaTravada}
              className={`flex items-center gap-2 px-3 py-1 rounded text-sm ${
                meuParticipante?.tipo_escolhido === t
                  ? "bg-blue-600 text-white"
                  : "bg-gray-200"
              } ${disputaTravada ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {renderTipoIcon(t, 20)}
              <span className="capitalize">{t}</span>
            </button>
          ))}
        </div>
        {meuParticipante?.tipo_escolhido && (
          <p className="text-sm text-green-600 mt-2 flex items-center gap-2">
            Você escolheu:
            {renderTipoIcon(meuParticipante.tipo_escolhido, 24)}
            <span className="capitalize">{meuParticipante.tipo_escolhido}</span>
          </p>
        )}
      </div>

      {/* declarar resultado: só em batalha */}
      {disputa.status === "batalhando" && (
        <div className="bg-white border rounded p-4">
          <h2 className="font-semibold mb-2">Declarar resultado</h2>
          <p className="text-sm text-gray-500 mb-2">
            Só vale 1 confronto por dupla. Empate = 1 ponto pra cada.
          </p>
          <select
            value={oponente}
            onChange={(e) => setOponente(e.target.value)}
            className="border px-2 py-1 rounded mb-2"
          >
            <option value="">Selecione o adversário</option>
            {participantes
              .filter((p) => p.usuario_uid !== userUid)
              .map((p) => (
                <option key={p.usuario_uid} value={p.usuario_uid}>
                  {p.nome || p.email || p.usuario_uid}
                  {p.tipo_escolhido ? ` (${p.tipo_escolhido})` : ""}
                </option>
              ))}
          </select>
          <br />
          <div className="flex gap-2">
            <button
              onClick={handleDeclararVitoria}
              disabled={declarando || !oponente || !meuParticipante?.tipo_escolhido}
              className="bg-green-600 text-white px-3 py-1 rounded text-sm disabled:opacity-50"
            >
              Eu ganhei
            </button>
            <button
              onClick={handleDeclararEmpate}
              disabled={declarando || !oponente || !meuParticipante?.tipo_escolhido}
              className="bg-yellow-500 text-white px-3 py-1 rounded text-sm disabled:opacity-50"
            >
              Empatamos
            </button>
          </div>
        </div>
      )}

      {/* resultados para confirmar */}
      {pendentesParaMim.length > 0 && (
        <div className="bg-white border rounded p-4">
          <h2 className="font-semibold mb-2">Resultados para confirmar</h2>
          <ul className="space-y-2">
            {pendentesParaMim.map((r) => {
              const outroUid =
                r.tipo === "empate"
                  ? r.jogador1_uid === userUid
                    ? r.jogador2_uid
                    : r.jogador1_uid
                  : r.vencedor_uid;
              const outro = participantes.find((p) => p.usuario_uid === outroUid);
              return (
                <li key={r.id} className="flex justify-between items-center gap-2">
                  <span className="text-sm">
                    {r.tipo === "empate" ? (
                      <>
                        {outro?.nome || outro?.email || outroUid} disse que empatou com você.
                      </>
                    ) : (
                      <>
                        {outro?.nome || outro?.email || outroUid} disse que ganhou de você.
                      </>
                    )}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleConfirmarResultado(r, "confirmado")}
                      className="bg-blue-600 text-white px-2 py-1 rounded text-xs"
                    >
                      Confirmar
                    </button>
                    <button
                      onClick={() => handleConfirmarResultado(r, "contestado")}
                      className="bg-red-500 text-white px-2 py-1 rounded text-xs"
                    >
                      Contestar
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ranking */}
      <div className="bg-white border rounded p-4">
        <h2 className="font-semibold mb-2">Ranking (confirmados)</h2>
        {ranking.length === 0 ? (
          <p>Ninguém na disputa.</p>
        ) : (
          <ul className="space-y-1">
            {ranking.map((p) => (
              <li key={p.usuario_uid} className="flex justify-between items-center text-sm">
                <span className="flex items-center gap-2">
                    {p.nome || p.email || p.usuario_uid}
                    {p.tipo_escolhido && renderTipoIcon(p.tipo_escolhido, 20)}
                </span>
                <span className="font-semibold">{pontos[p.usuario_uid] || 0} pts</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
