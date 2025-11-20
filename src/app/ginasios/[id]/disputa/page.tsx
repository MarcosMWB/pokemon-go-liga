// src/app/ginasios/[id]/page.tsx
"use client";

import type { User } from "firebase/auth";
import { useEffect, useMemo, useRef, useState } from "react";
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
  orderBy,
  serverTimestamp,
  Unsubscribe,
} from "firebase/firestore";

const TIPOS = [
  "normal", "fire", "water", "grass", "electric", "ice", "fighting", "poison", "ground", "flying",
  "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy",
];

type Ginasio = {
  id: string;
  nome: string;
  tipo: string;
  lider_uid?: string;
  liga?: string;
};

type Disputa = {
  id: string;
  ginasio_id: string;
  status: "inscricoes" | "batalhando" | "finalizado";
  tipo_original: string;
  liga?: string;
  liga_nome?: string;
  finalizacao_aplicada?: boolean;
  temporada_id?: string;
  temporada_nome?: string;
  origem?: "disputa" | "renuncia" | "3_derrotas" | "manual" | "empate";
  createdAtMs?: number | null;
  vencedor_uid?: string | null; // <- adicionada p/ parabéns
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

type Usuario = {
  id: string;
  nome?: string;
  email?: string;
  friend_code?: string;
};

// ===== utils de data =====
function toMillis(v: any): number | null {
  if (!v) return null;
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "object" && "seconds" in v) {
    const sec = (v as any).seconds ?? 0;
    const ns = (v as any).nanoseconds ?? 0;
    return sec * 1000 + Math.floor(ns / 1e6);
  }
  return null;
}
function fmtCountdown(msDiff: number): string {
  // recebe diferença (alvo - agora)
  const neg = msDiff < 0;
  const abs = Math.abs(msDiff);
  const d = Math.floor(abs / 86400000);
  const h = Math.floor((abs % 86400000) / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return neg ? `em: ${parts.join(" ")}` : `em ${parts.join(" ")}`;
}

export default function DisputaGinasioPage() {
  const params = useParams();
  const router = useRouter();
  const ginasioId = params?.id as string;

  const [userUid, setUserUid] = useState<string | null>(null);
  const [isSuper, setIsSuper] = useState(false);

  const [ginasio, setGinasio] = useState<Ginasio | null>(null);
  const [disputa, setDisputa] = useState<Disputa | null>(null);
  const [participantes, setParticipantes] = useState<Participante[]>([]);
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [ocupados, setOcupados] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [salvandoTipo, setSalvandoTipo] = useState(false);
  const [declarando, setDeclarando] = useState(false);
  const [oponente, setOponente] = useState("");
  const [avisoTipoInvalidado, setAvisoTipoInvalidado] = useState<string | null>(null);

  // CHAT
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDesafioId, setChatDesafioId] = useState<string | null>(null);
  const [chatMsgs, setChatMsgs] = useState<{ id: string; from: string; text: string; createdAt: any }[]>([]);
  const [chatOther, setChatOther] = useState<Usuario | null>(null);
  const [chatInput, setChatInput] = useState("");
  const chatUnsubRef = useRef<Unsubscribe | null>(null);
  const desafioUnsubRef = useRef<Unsubscribe | null>(null);
  const isAndroid = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent || "");

  // info do "Converse com o adversário"
  const [chatInfoOpen, setChatInfoOpen] = useState(false);

  // ====== NOVO: variáveis globais (horas) ======
  const [tempoInscricoesHoras, setTempoInscricoesHoras] = useState<number | null>(null);
  const [tempoBatalhasHoras, setTempoBatalhasHoras] = useState<number | null>(null);
  const [, forceTick] = useState(0); // para re-render do countdown
  const [winnerName, setWinnerName] = useState<string | null>(null); // <- nome p/ parabéns

  useEffect(() => {
    // lê variables/global { tempo_inscricoes: number, tempo_batalhas: number } (em horas)
    (async () => {
      try {
        const vSnap = await getDoc(doc(db, "variables", "global"));
        if (vSnap.exists()) {
          const v = vSnap.data() as any;
          setTempoInscricoesHoras(Number(v?.tempo_inscricoes ?? 0));
          setTempoBatalhasHoras(Number(v?.tempo_batalhas ?? 0));
        } else {
          // se não existir, deixa null (UI mostra aviso)
          setTempoInscricoesHoras(null);
          setTempoBatalhasHoras(null);
        }
      } catch {
        setTempoInscricoesHoras(null);
        setTempoBatalhasHoras(null);
      }
    })();
    const t = setInterval(() => forceTick((x) => x + 1), 30000); // atualiza contagem a cada 30s
    return () => clearInterval(t);
  }, []);

  const renderTipoIcon = (tipo?: string, size = 28) => {
    if (!tipo) return null;
    const src = TYPE_ICONS[tipo];
    if (!src) return <span className="text-xs text-gray-500">{tipo}</span>;
    return <Image src={src} alt={tipo} width={size} height={size} className="inline-block" />;
  };

  function makePairKey(a: string, b: string, gId: string, dId: string) {
    const [x, y] = [a, b].sort();
    return `${x}__${y}__${gId}__${dId}`;
  }
  function qrUrl(data: string) {
    return `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(data)}`;
  }
  function buildPoGoFriendLinks(fc: string) {
    const native = `pokemongo://?dl_action=AddFriend&DlId=${encodeURIComponent(fc)}`;
    const androidIntent = `intent://?dl_action=AddFriend&DlId=${encodeURIComponent(fc)}#Intent;scheme=pokemongo;package=com.nianticlabs.pokemongo;end`;
    return { native, androidIntent };
  }

  // 1) auth + superuser
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (current: User | null) => {
      if (!current) {
        setUserUid(null);
        setIsSuper(false);
        router.replace("/login");
        return;
      }
      setUserUid(current.uid);
      try {
        const superSnap = await getDoc(doc(db, "superusers", current.uid));
        setIsSuper(superSnap.exists());
      } catch {
        setIsSuper(false);
      }
    });
    return () => unsub();
  }, [router]);

  // 2) ouvir ginásio + disputa
  useEffect(() => {
    if (!ginasioId) return;

    const unsubG = onSnapshot(doc(db, "ginasios", ginasioId), (snap) => {
      if (!snap.exists()) return;
      const d = snap.data() as any;
      setGinasio({
        id: snap.id,
        nome: d.nome,
        tipo: d.tipo || "",
        lider_uid: d.lider_uid || "",
        liga: d.liga || d.liga_nome || "",
      });
    });

    const qDisputa = query(
      collection(db, "disputas_ginasio"),
      where("ginasio_id", "==", ginasioId),
      where("status", "in", ["inscricoes", "batalhando", "finalizado"])
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
        liga: dData.liga || dData.liga_nome || "",
        liga_nome: dData.liga_nome || dData.liga || "",
        finalizacao_aplicada: dData.finalizacao_aplicada === true,
        temporada_id: dData.temporada_id || "",
        temporada_nome: dData.temporada_nome || "",
        origem: dData.origem as any,
        createdAtMs: toMillis(dData.createdAt),
        vencedor_uid: dData.vencedor_uid ?? null, // <- ler vencedor
      });
      setLoading(false);
    });

    return () => {
      unsubG();
      unsubD();
    };
  }, [ginasioId]);

  // 3) participantes
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
          return { id: p.id, usuario_uid: d.usuario_uid, tipo_escolhido: d.tipo_escolhido || "", removido: d.removido === true };
        })
        .filter((p) => !p.removido);

      const withNames: Participante[] = [];
      for (const p of base) {
        const uSnap = await getDoc(doc(db, "usuarios", p.usuario_uid));
        if (uSnap.exists()) {
          const u = uSnap.data() as any;
          withNames.push({ id: p.id, usuario_uid: p.usuario_uid, tipo_escolhido: p.tipo_escolhido, nome: u.nome, email: u.email });
        } else {
          withNames.push({ id: p.id, usuario_uid: p.usuario_uid, tipo_escolhido: p.tipo_escolhido });
        }
      }
      setParticipantes(withNames);
    });

    return () => unsub();
  }, [disputa]);

  // 4) resultados
  useEffect(() => {
    if (!disputa) return;

    const qRes = query(collection(db, "disputas_ginasio_resultados"), where("disputa_id", "==", disputa.id));
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

  // 5) tipos ocupados na liga
  useEffect(() => {
    if (!disputa) return;

    const ligaDaDisputa = disputa.liga || disputa.liga_nome || "";
    const unsub = onSnapshot(collection(db, "ginasios"), (snap) => {
      const v: string[] = [];
      snap.forEach((g) => {
        const d = g.data() as any;
        if (g.id === disputa.ginasio_id) return;
        const ligaDoGinasio = d.liga || d.liga_nome || "";
        if (ligaDaDisputa) {
          if (!ligaDoGinasio) return;
          if (ligaDoGinasio !== ligaDaDisputa) return;
        }
        if (d.tipo) v.push(d.tipo);
      });
      setOcupados(v);
    });

    return () => unsub();
  }, [disputa]);

  const disputaTravada = disputa?.status === "batalhando";

  const existeResultadoEntre = (a: string, b: string): boolean => {
    return resultados.some((r) => {
      if (r.status === "contestado") return false;
      if (r.tipo === "empate") {
        return ((r.jogador1_uid === a && r.jogador2_uid === b) || (r.jogador1_uid === b && r.jogador2_uid === a));
      }
      return ((r.vencedor_uid === a && r.perdedor_uid === b) || (r.vencedor_uid === b && r.perdedor_uid === a));
    });
  };

  const handleEscolherTipo = async (tipo: string) => {
    if (!userUid || !disputa) return;
    if (disputaTravada) return;
    setSalvandoTipo(true);

    const qP = query(
      collection(db, "disputas_ginasio_participantes"),
      where("disputa_id", "==", disputa.id),
      where("usuario_uid", "==", userUid)
    );
    const snap = await getDocs(qP);
    if (snap.empty) {
      await addDoc(collection(db, "disputas_ginasio_participantes"), {
        disputa_id: disputa.id,
        ginasio_id: disputa.ginasio_id,
        usuario_uid: userUid,
        tipo_escolhido: tipo,
        createdAt: Date.now(),
      });
    } else {
      await updateDoc(snap.docs[0].ref, { tipo_escolhido: tipo });
    }

    setAvisoTipoInvalidado(null);
    setSalvandoTipo(false);
  };

  const handleDeclararVitoria = async () => {
    if (!userUid || !disputa || !oponente) return;
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
      disputa_id: disputa.id, ginasio_id: disputa.ginasio_id,
      vencedor_uid: userUid, perdedor_uid: oponente, declarado_por: userUid,
      status: "pendente", createdAt: Date.now(),
    });
    setDeclarando(false);
  };

  const handleDeclararEmpate = async () => {
    if (!userUid || !disputa || !oponente) return;
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
      disputa_id: disputa.id, ginasio_id: disputa.ginasio_id,
      tipo: "empate", jogador1_uid: userUid, jogador2_uid: oponente,
      declarado_por: userUid, status: "pendente", createdAt: Date.now(),
    });
    setDeclarando(false);
  };

  const handleConfirmarResultado = async (res: Resultado, novoStatus: "confirmado" | "contestado") => {
    await updateDoc(doc(db, "disputas_ginasio_resultados", res.id), { status: novoStatus, atualizadoEm: Date.now() });
  };

  // Meu participante
  const meuParticipante = userUid ? participantes.find((p) => p.usuario_uid === userUid) : null;

  // Invalidar tipo se ficou indisponível durante inscrições
  useEffect(() => {
    const invalidarSeOcupou = async () => {
      if (!disputa || disputa.status !== "inscricoes" || !userUid || !meuParticipante?.id || !meuParticipante?.tipo_escolhido) return;

      const escolhido = meuParticipante.tipo_escolhido;
      const ocupou = escolhido !== disputa.tipo_original && ocupados.includes(escolhido);
      if (ocupou) {
        try {
          await updateDoc(doc(db, "disputas_ginasio_participantes", meuParticipante.id), {
            tipo_escolhido: "",
            invalidado: true,
            invalidado_motivo: "tipo_indisponivel",
            invalidadoEm: Date.now(),
          });
          setAvisoTipoInvalidado(`Seu tipo "${escolhido}" ficou indisponível na liga e foi removido. Escolha outro.`);
        } catch (e) {
          console.error("falha ao invalidar tipo", e);
        }
      }
    };
    invalidarSeOcupou();
  }, [disputa, userUid, meuParticipante?.id, meuParticipante?.tipo_escolhido, ocupados]);

  // Pontuação
  const pontos = useMemo(() => {
    const map: Record<string, number> = {};
    participantes.forEach((p) => (map[p.usuario_uid] = 0));
    resultados.forEach((r) => {
      if (r.status !== "confirmado") return;
      if (r.tipo === "empate") {
        if (r.jogador1_uid) map[r.jogador1_uid] = (map[r.jogador1_uid] || 0) + 1;
        if (r.jogador2_uid) map[r.jogador2_uid] = (map[r.jogador2_uid] || 0) + 1;
      } else if (r.vencedor_uid) {
        map[r.vencedor_uid] = (map[r.vencedor_uid] || 0) + 3;
      }
    });
    return map;
  }, [participantes, resultados]);

  const ranking = useMemo(() => {
    return [...participantes].sort((a, b) => ((pontos[b.usuario_uid] || 0) - (pontos[a.usuario_uid] || 0)));
  }, [participantes, pontos]);

  // Finalização automática (apenas SUPERUSER)
  useEffect(() => {
    const aplicarFinalizacao = async () => {
      if (!disputa || !ginasio || !isSuper) return;
      if (disputa.status !== "finalizado" || disputa.finalizacao_aplicada) return;

      try {
        if (ranking.length === 0) return;
        const topo = ranking[0];
        const pTopo = pontos[topo.usuario_uid] || 0;
        const empatadosTopo = ranking.filter((p) => (pontos[p.usuario_uid] || 0) === pTopo);
        if (empatadosTopo.length > 1) {
          await updateDoc(doc(db, "disputas_ginasio", disputa.id), {
            empate_no_topo: true,
            finalizacao_aplicada: false,
            tentativa_finalizacao_em: Date.now(),
          });
          return;
        }

        const novoLiderUid = topo.usuario_uid;
        const tipoNovo = topo.tipo_escolhido || ginasio.tipo || disputa.tipo_original || "";
        const ligaDoGinasio = ginasio.liga || disputa.liga || disputa.liga_nome || "";

        await updateDoc(doc(db, "ginasios", ginasio.id), {
          lider_uid: novoLiderUid,
          tipo: tipoNovo,
          em_disputa: false,
          derrotas_seguidas: 0,
        });

        await addDoc(collection(db, "ginasios_liderancas"), {
          ginasio_id: ginasio.id,
          lider_uid: novoLiderUid,
          inicio: Date.now(),
          fim: null,
          origem: "disputa",
          liga: ligaDoGinasio || "",
          temporada_id: disputa.temporada_id || "",
          temporada_nome: disputa.temporada_nome || "",
          tipo_no_periodo: tipoNovo || "",
          createdByAdminUid: auth.currentUser?.uid || null,
          endedByAdminUid: null,
        });

        await updateDoc(doc(db, "disputas_ginasio", disputa.id), {
          finalizacao_aplicada: true,
          vencedor_uid: novoLiderUid,
          aplicado_em: Date.now(),
          aplicadoPorAdminUid: auth.currentUser?.uid || null,
        });
      } catch (e) {
        console.warn("Falha ao aplicar finalização da disputa:", e);
      }
    };
    aplicarFinalizacao();
  }, [disputa, ginasio, ranking, pontos, isSuper]);

  // ====== CHAT / DESAFIO ======
  async function ensureDesafio(opponentUid: string) {
    if (!userUid || !disputa || !ginasio) return null;
    const pairKey = makePairKey(userUid, opponentUid, ginasio.id, disputa.id);

    const qDes = query(collection(db, "desafios_ginasio"), where("pairKey", "==", pairKey));
    const found = await getDocs(qDes);
    if (!found.empty) return found.docs[0].id;

    const ref = await addDoc(collection(db, "desafios_ginasio"), {
      pairKey,
      disputa_id: disputa.id,
      ginasio_id: ginasio.id,
      liga: disputa.liga || ginasio.liga || "",
      status: "pendente",
      lider_uid: userUid,
      desafiante_uid: opponentUid,
      createdAt: Date.now(),
    });
    return ref.id;
  }

  async function openDesafioChat(desafioId: string) {
    if (!userUid) return;

    chatUnsubRef.current?.();
    chatUnsubRef.current = null;
    desafioUnsubRef.current?.();
    desafioUnsubRef.current = null;

    setChatOpen(true);
    setChatDesafioId(desafioId);
    setChatMsgs([]);
    setChatInput("");
    setChatOther(null);

    const dRef = doc(db, "desafios_ginasio", desafioId);
    const dSnap = await getDoc(dRef);
    if (!dSnap.exists()) {
      setChatOpen(false);
      setChatDesafioId(null);
      return;
    }
    const d = dSnap.data() as any;
    const otherUid = d.lider_uid === userUid ? d.desafiante_uid : d.lider_uid;

    let other: Usuario = { id: otherUid };
    try {
      const u = await getDoc(doc(db, "usuarios", otherUid));
      if (u.exists()) {
        const du = u.data() as any;
        other = { id: otherUid, nome: du.nome || du.email || otherUid, email: du.email, friend_code: du.friend_code };
      }
    } catch { }
    setChatOther(other);

    const msgsQ = query(collection(db, "desafios_ginasio", desafioId, "mensagens"), orderBy("createdAt", "asc"));
    chatUnsubRef.current = onSnapshot(
      msgsQ,
      (snap) => {
        setChatMsgs(snap.docs.map((d) => {
          const x = d.data() as any;
          return { id: d.id, from: x.from, text: x.text, createdAt: x.createdAt };
        }));
      },
      (err) => {
        console.error("Chat listener error:", err);
        setChatOpen(false);
        setChatDesafioId(null);
      }
    );

    desafioUnsubRef.current = onSnapshot(
      dRef,
      (ds) => {
        if (!ds.exists()) return;
        const dd = ds.data() as any;
        if (dd.status === "concluido" || dd.status === "conflito") {
          setChatOpen(false);
          setChatDesafioId(null);
        }
      },
      (err) => console.error("Desafio listener error:", err)
    );
  }

  async function handleChamar(uid: string) {
    if (!userUid || uid === userUid) return;
    const id = await ensureDesafio(uid);
    if (id) await openDesafioChat(id);
  }

  async function sendChatMessage() {
    if (!userUid || !chatDesafioId || !chatInput.trim()) return;
    await addDoc(collection(db, "desafios_ginasio", chatDesafioId, "mensagens"), {
      from: userUid, text: chatInput.trim(), createdAt: serverTimestamp(),
    });
    setChatInput("");
  }

  // ====== DERIVADOS ======
  const tiposPermitidos = TIPOS.filter((t) => {
    if (!disputa) return true;
    if (t === disputa.tipo_original) return true;
    return !ocupados.includes(t);
  });

  const pendentesParaMim =
    userUid
      ? resultados.filter((r) => {
        if (r.status !== "pendente") return false;
        if (r.declarado_por === userUid) return false;
        if (r.tipo === "empate") return r.jogador1_uid === userUid || r.jogador2_uid === userUid;
        return r.perdedor_uid === userUid;
      })
      : [];

  const participantesOrdenados = useMemo(() => {
    return participantes
      .slice()
      .sort((a, b) => ((a.nome || a.email || a.usuario_uid).localeCompare(b.nome || b.email || b.usuario_uid)));
  }, [participantes]);

  const fc = chatOther?.friend_code || null;
  const friendLinks = fc ? buildPoGoFriendLinks(fc) : null;
  const deepLink = fc ? (isAndroid ? friendLinks!.androidIntent : friendLinks!.native) : null;
  const qrLink = fc ? qrUrl(friendLinks!.native) : null;

  // ====== NOVO: cálculos de início/fim ======
  const battleStartMs =
    disputa?.createdAtMs != null && tempoInscricoesHoras != null
      ? disputa.createdAtMs + tempoInscricoesHoras * 3600000
      : null;

  const disputeEndMs =
    battleStartMs != null && tempoBatalhasHoras != null
      ? battleStartMs + tempoBatalhasHoras * 3600000
      : null;

  // countdowns só nos status corretos
  const showStartCountdown =
    disputa?.status === "inscricoes" && battleStartMs != null;
  const showEndCountdown =
    (disputa?.status === "inscricoes" || disputa?.status === "batalhando") && disputeEndMs != null;

  // carregar nome do vencedor quando finalizado
  useEffect(() => {
    const loadWinner = async () => {
      if (!disputa || disputa.status !== "finalizado") {
        setWinnerName(null);
        return;
      }
      const uid = disputa.vencedor_uid || ginasio?.lider_uid || null;
      if (!uid) {
        setWinnerName(null);
        return;
      }
      try {
        const u = await getDoc(doc(db, "usuarios", uid));
        if (u.exists()) {
          const d = u.data() as any;
          setWinnerName(d.nome || d.email || uid);
        } else {
          setWinnerName(uid);
        }
      } catch {
        setWinnerName(uid);
      }
    };
    loadWinner();
  }, [disputa?.status, disputa?.vencedor_uid, ginasio?.lider_uid]);

  if (loading) return <p className="p-8">Carregando disputa...</p>;
  if (!ginasio) return <p className="p-8">Ginásio não encontrado.</p>;
  if (!disputa) {
    return (
      <div className="p-8">
        <p className="mb-4">Nenhuma disputa aberta para este ginásio.</p>
        <button onClick={() => router.push("/ginasios")} className="bg-blue-600 text-white px-4 py-2 rounded">
          Voltar
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">
        Disputa do ginásio {ginasio.nome}
        {disputa.liga_nome ? <span className="ml-2 text-sm text-gray-500">({disputa.liga_nome})</span> : null}
      </h1>

      {!ginasio.lider_uid && (
        <p className="text-sm bg-yellow-100 text-yellow-800 px-3 py-2 rounded">
          Ginásio sem líder. Quem tiver mais pontos quando o admin encerrar fica com a vaga.
        </p>
      )}

      <p className="text-gray-600">
        Status: {disputa.status === "inscricoes" ? "inscrições abertas" : disputa.status}
        {disputa.status === "finalizado" && (
          <span className="ml-2 text-xs text-gray-500">
            {disputa.finalizacao_aplicada ? " (aplicado)" : " (aguardando aplicação pelo admin)"}
          </span>
        )}
      </p>

      {/* NOVO: bloco de prazos ou parabéns, sem remover nada do resto */}
      {disputa.status !== "finalizado" ? (
        <div className="bg-indigo-50 border border-indigo-200 rounded p-3 text-sm text-indigo-900">
          {tempoInscricoesHoras == null || tempoBatalhasHoras == null ? (
            <p>
              Configure <b>variables/global</b> com números (horas):{" "}
              <code>tempo_inscricoes</code> e <code>tempo_batalhas</code>.
            </p>
          ) : disputa.createdAtMs == null ? (
            <p>Sem <code>createdAt</code> na disputa — não dá para calcular os prazos.</p>
          ) : (
            <>
              {showStartCountdown && (
                <p>
                  Fase de batalhas começa {fmtCountdown((battleStartMs ?? 0) - Date.now())}{" "}
                  <span className="text-xs text-indigo-700">
                    (inscrições: {tempoInscricoesHoras} horas de inscrições)
                  </span>
                </p>
              )}
              {showEndCountdown && (
                <p>
                  Disputa pelo ginásio termina {fmtCountdown((disputeEndMs ?? 0) - Date.now())}{" "}
                  <span className="text-xs text-indigo-700">
                    (batalhas: {tempoBatalhasHoras} horas de batalhas)
                  </span>
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="bg-green-50 border border-green-200 rounded p-3 text-green-800">
          <p>
            🎉 Parabéns <b>{winnerName || "ao novo líder"}</b>! Você é o novo líder do ginásio <b>{ginasio.nome}</b>.
          </p>
        </div>
      )}

      {avisoTipoInvalidado && (
        <div className="bg-yellow-100 border border-yellow-300 text-yellow-900 px-3 py-2 rounded">
          {avisoTipoInvalidado}
        </div>
      )}

      <div className="card p-4">
        <h2 className="font-semibold mb-2">Seu tipo na disputa</h2>
        {disputaTravada && <p className="text-xs text-red-500 mb-2">Disputa iniciada. Não dá mais pra trocar.</p>}
        <div className="flex flex-wrap gap-2">
          {tiposPermitidos.map((t) => (
            <button
              key={t}
              onClick={() => handleEscolherTipo(t)}
              disabled={salvandoTipo || disputaTravada}
              className={`flex items-center gap-2 px-3 py-1 rounded text-sm ${meuParticipante?.tipo_escolhido === t ? "bg-blue-600 text-white" : "bg-gray-200"
                } ${disputaTravada ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {renderTipoIcon(t, 20)}
              <span className="capitalize">{t}</span>
            </button>
          ))}
        </div>
        {meuParticipante?.tipo_escolhido ? (
          <p className="text-sm text-green-600 mt-2 flex items-center gap-2">
            Você escolheu: {renderTipoIcon(meuParticipante.tipo_escolhido, 24)}
            <span className="capitalize">{meuParticipante.tipo_escolhido}</span>
          </p>
        ) : (
          <p className="text-xs text-gray-500 mt-2">Escolha um tipo disponível da liga para participar.</p>
        )}
      </div>

      {disputa.status === "batalhando" && (
        <div className="card p-4 space-y-3">
          <h2 className="font-semibold">Declarar resultado</h2>
          <p className="text-sm text-gray-500">Só vale 1 confronto por dupla. Empate = 1 ponto pra cada.</p>
          <div className="flex items-center gap-2">
            <select value={oponente} onChange={(e) => setOponente(e.target.value)} className="border px-2 py-1 rounded">
              <option value="">Selecione o adversário</option>
              {participantes.filter((p) => p.usuario_uid !== userUid).map((p) => (
                <option key={p.usuario_uid} value={p.usuario_uid}>
                  {p.nome || p.email || p.usuario_uid}{p.tipo_escolhido ? ` (${p.tipo_escolhido})` : ""}
                </option>
              ))}
            </select>

            {!!oponente && (
              <button onClick={() => handleChamar(oponente)} className="bg-slate-800 text-white px-3 py-1 rounded text-sm">
                Abrir chat
              </button>
            )}
          </div>

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

      <div className="card p-4">
        <h2 className="font-semibold mb-2">Participantes</h2>
        {participantesOrdenados.length === 0 ? (
          <p className="text-sm text-gray-500">Ninguém inscrito.</p>
        ) : (
          <ul className="space-y-2">
            {participantesOrdenados.map((p) => (
              <li key={p.id} className="flex items-center justify-between bg-gray-50 rounded px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{p.nome || p.email || p.usuario_uid}</p>
                  <div className="text-xs text-gray-600 flex items-center gap-2">
                    <span>Tipo:</span>
                    {p.tipo_escolhido ? (
                      <>
                        {renderTipoIcon(p.tipo_escolhido, 16)}
                        <span className="capitalize">{p.tipo_escolhido}</span>
                      </>
                    ) : (
                      <span>—</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {meuParticipante?.tipo_escolhido && p.tipo_escolhido && (
                    <button
                      onClick={() => handleChamar(p.usuario_uid)}
                      className="bg-slate-800 text-white text-xs px-3 py-1 rounded"
                    >
                      Chamar p/ batalha
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {pendentesParaMim.length > 0 && (
        <div className="card p-4">
          <h2 className="font-semibold mb-2">Resultados para confirmar</h2>
          <ul className="space-y-2">
            {pendentesParaMim.map((r) => {
              const outroUid = r.tipo === "empate" ? (r.jogador1_uid === userUid ? r.jogador2_uid : r.jogador1_uid) : r.vencedor_uid;
              const outro = participantes.find((p) => p.usuario_uid === (outroUid || ""));
              return (
                <li key={r.id} className="flex justify-between items-center gap-2">
                  <span className="text-sm">
                    {r.tipo === "empate"
                      ? <>{outro?.nome || outro?.email || outroUid} disse que empatou com você.</>
                      : <>{outro?.nome || outro?.email || outroUid} disse que ganhou de você.</>}
                  </span>
                  <div className="flex gap-2">
                    <button onClick={() => handleConfirmarResultado(r, "confirmado")} className="bg-blue-600 text-white px-2 py-1 rounded text-xs">
                      Confirmar
                    </button>
                    <button onClick={() => handleConfirmarResultado(r, "contestado")} className="bg-red-500 text-white px-2 py-1 rounded text-xs">
                      Contestar
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="card p-4">
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

      {chatOpen && chatDesafioId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setChatOpen(false); setChatDesafioId(null); }} />
          <div className="relative bg-white w-full max-w-2xl rounded-xl shadow-xl p-4 md:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Desafio & Chat</h3>
                {/* texto removido daqui, conforme pedido */}
              </div>
              <button
                className="text-slate-500 hover:text-slate-800 text-sm"
                onClick={() => { setChatOpen(false); setChatDesafioId(null); }}
              >
                Fechar
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border rounded-lg p-3">
                <p className="text-xs text-slate-500">Adicionar {chatOther?.nome || "Treinador"}:</p>
                {fc ? (
                  <>
                    <p className="text-sm font-semibold">FC: {fc}</p>
                    <div className="mt-2 flex flex-col items-start gap-2">
                      {deepLink && <a href={deepLink} className="text-blue-600 text-sm hover:underline">Abrir no Pokémon GO</a>}
                      {qrLink && <Image src={qrLink} alt="QR para adicionar" width={160} height={160} className="w-40 h-40 border rounded" />}

                      {/* linha com Copiar FC + Converse com o adversário + ícone de info */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => (navigator as any)?.clipboard?.writeText?.(fc)}
                          className="text-xs bg-slate-200 hover:bg-slate-300 px-2 py-1 rounded"
                          type="button"
                        >
                          Copiar FC
                        </button>

                        <span className="text-xs text-slate-700">
                          Converse com o adversário
                        </span>

                        <button
                          type="button"
                          onClick={() => setChatInfoOpen((v) => !v)}
                          className="flex items-center justify-center w-5 h-5 rounded-full border border-slate-300 text-[10px] text-slate-600 hover:bg-slate-100"
                          aria-label="Informações sobre como conversar com o adversário"
                        >
                          i
                        </button>
                      </div>

                      {chatInfoOpen && (
                        <p className="mt-1 text-xs text-slate-500">
                          Mande uma mensagem. Combine horários, locais e meios de comunicação, como número telefônico.
                        </p>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-amber-600">O oponente não cadastrou FC.</p>
                )}
              </div>
            </div>

            <div className="mt-4 border rounded-lg p-3 max-h-72 overflow-auto bg-slate-50">
              {chatMsgs.length === 0 ? (
                <p className="text-xs text-slate-500">Nenhuma mensagem ainda.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {chatMsgs.map((m) => {
                    const mine = m.from === userUid;
                    return (
                      <div
                        key={m.id}
                        className={`max-w-[85%] px-3 py-2 rounded ${mine ? "self-end bg-blue-600 text-white" : "self-start bg-white border"
                          }`}
                      >
                        <p className="text-xs">{m.text}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-3 flex items-center gap-2">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendChatMessage()}
                className="flex-1 border rounded px-3 py-2 text-sm"
                placeholder="Escreva uma mensagem..."
              />
              <button
                onClick={async () => { await sendChatMessage(); }}
                className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded"
                type="button"
              >
                Enviar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
