// src/lib/desafiosService.ts
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  runTransaction,
  serverTimestamp,
  updateDoc,
  setDoc,
  query,
  where,
  limit,
  Firestore,
  orderBy,
} from "firebase/firestore";

export type Role = "lider" | "desafiante";
export type Vencedor = "lider" | "desafiante";

type TemporadaAtiva = { id?: string; nome?: string } | null;

type FechamentoResultado =
  | { closed: false; status?: string; desafio?: any }
  | {
      closed: true;
      status: "concluido" | "conflito";
      vencedor?: Vencedor; // quando concluido
      desafio: any; // snapshot.data() final
    };

function asInt(x: any) {
  const n = Number(x);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function calcElite4Points(w: number, l: number) {
  // (vitórias * 2) - derrotas, com clamp: negativo = 0, zero = 1
  const base = 2 * asInt(w) - asInt(l);
  if (base < 0) return 0;
  if (base === 0) return 1;
  return base;
}

async function getElite4CampeonatoAtivoId(db: Firestore, liga: string): Promise<string | null> {
  const q = query(
    collection(db, "campeonatos_elite4"),
    where("liga", "==", liga),
    where("status", "==", "aberto"),
    orderBy("createdAt", "desc"),
    limit(1)
  );
  const s = await getDocs(q);
  return s.empty ? null : s.docs[0].id;
}

async function efeitosVitoriaLider(db: Firestore, d: any) {
  const gRef = doc(db, "ginasios", d.ginasio_id);
  const desafRef = doc(db, "usuarios", d.desafiante_uid);

  // ler stats do desafiante ANTES de registrar a derrota
  const desafSnap = await getDoc(desafRef);
  const ds = desafSnap.exists() ? (desafSnap.data() as any) : {};
  const w = asInt(ds?.statsvitorias);
  const l = asInt(ds?.statsderrotas);

  const pts = calcElite4Points(w, l);

  let liga: string = d.liga || "";
  if (!liga) {
    const gSnap = await getDoc(gRef);
    liga = gSnap.exists() ? ((gSnap.data() as any).liga || "") : "";
  }

  // credita pontos no Elite4 (uma única vez) — SUBCOLEÇÃO
  const elite4Id = liga ? await getElite4CampeonatoAtivoId(db, liga) : null;
  if (elite4Id && pts > 0) {
    const partRef = doc(db, "campeonatos_elite4", elite4Id, "participantes", d.lider_uid);

    // cria/mescla metadados — sem pontos no set
    await setDoc(
      partRef,
      {
        usuario_uid: d.lider_uid,
        campeonato_id: elite4Id,
        ginasio_id: d.ginasio_id,
        liga,
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );

    // incrementa UMA vez
    await updateDoc(partRef, { pontos: increment(pts) });
  }

  // efeitos padrão
  await Promise.all([
    updateDoc(gRef, { derrotas_seguidas: 0 }),
    addDoc(collection(db, "bloqueios_ginasio"), {
      ginasio_id: d.ginasio_id,
      desafiante_uid: d.desafiante_uid,
      proximo_desafio: Date.now() + 15 * 24 * 60 * 60 * 1000,
      createdAt: serverTimestamp(),
    }),
    updateDoc(desafRef, { statsderrotas: increment(1) }),
  ]);
}

async function resetElite4PontuacaoDoUsuario(
  db: Firestore,
  userUid: string,
  ginasioId?: string,
  motivo?: "renuncia" | "3_derrotas",
  ligaParam?: string
) {
  if (!userUid) return;

  // resolve liga: param -> via ginásio -> aborta se não achar
  let liga = ligaParam || "";
  if (!liga && ginasioId) {
    const g = await getDoc(doc(db, "ginasios", ginasioId));
    if (g.exists()) liga = (g.data() as any).liga || "";
  }
  if (!liga) return;

  const elite4Id = await getElite4CampeonatoAtivoId(db, liga);
  if (!elite4Id) return;

  const partRef = doc(db, "campeonatos_elite4", elite4Id, "participantes", userUid);

  await setDoc(
    partRef,
    {
      usuario_uid: userUid,
      campeonato_id: elite4Id,
      ginasio_id: ginasioId ?? null,
      liga,
      pontos: 0,
      lastResetAt: serverTimestamp(),
      lastResetReason: motivo ?? null,
    },
    { merge: true }
  );
}

async function efeitosVitoriaDesafiante(
  db: Firestore,
  d: any,
  temp: TemporadaAtiva
) {
  const gRef = doc(db, "ginasios", d.ginasio_id);
  const gSnap = await getDoc(gRef);
  const g = gSnap.exists() ? (gSnap.data() as any) : null;

  await Promise.all([
    // 1) insígnia para o desafiante
    (async () => {
      await addDoc(collection(db, "insignias"), {
        usuario_uid: d.desafiante_uid,
        ginasio_id: d.ginasio_id,
        ginasio_nome: g?.nome || "",
        ginasio_tipo: g?.tipo || "",
        insignia_icon: g?.insignia_icon || "",
        temporada_id: temp?.id || "",
        temporada_nome: temp?.nome || "",
        liga: g?.liga || d.liga || "",
        lider_derrotado_uid: d.lider_uid,
        createdAt: Date.now(),
      });
    })(),

    // 2) bloqueio de 7 dias para novo desafio nesse ginásio
    (async () => {
      await addDoc(collection(db, "bloqueios_ginasio"), {
        ginasio_id: d.ginasio_id,
        desafiante_uid: d.desafiante_uid,
        proximo_desafio: Date.now() + 7 * 24 * 60 * 60 * 1000,
        createdAt: serverTimestamp(),
      });
    })(),

    // 3) stats do desafiante: +1 vitória
    (async () => {
      const desafRef = doc(db, "usuarios", d.desafiante_uid);
      await updateDoc(desafRef, { statsvitorias: increment(1) });
    })(),
  ]);

  // 4) derrotas seguidas do líder + possível abertura de disputa
  if (!gSnap.exists()) return;
  const derrotas = Math.max(0, Number(g?.derrotas_seguidas ?? 0) + 1);

  if (derrotas >= 3) {
    await Promise.all([
      addDoc(collection(db, "disputas_ginasio"), {
        ginasio_id: d.ginasio_id,
        status: "inscricoes",
        tipo_original: g?.tipo || "",
        lider_anterior_uid: g?.lider_uid || "",
        temporada_id: temp?.id || "",
        temporada_nome: temp?.nome || "",
        liga: g?.liga || d.liga || "",
        origem: "3_derrotas",
        createdAt: Date.now(),
      }),
      updateDoc(gRef, { lider_uid: "", em_disputa: true, derrotas_seguidas: 0 }),
    ]);

    if (g?.lider_uid) {
      await resetElite4PontuacaoDoUsuario(db, g.lider_uid, d.ginasio_id, "3_derrotas", g?.liga || d.liga || "");
    }
  } else {
    await updateDoc(gRef, { derrotas_seguidas: derrotas });
  }
}

/**
 * Marca o resultado do "meu lado" (líder/desafiante) e,
 * se ambos já declararam, fecha o desafio (concluido/conflito).
 * Idempotente: só aplica efeitos colaterais (insígnia, bloqueio, stats)
 * se ESTE call foi quem fechou o desafio agora.
 *
 * Aceita tanto `temporadaAtiva` quanto `temporada` no opts.
 */
export async function setResultadoEFecharSePossivel(opts: {
  db: Firestore;
  desafioId: string;
  role: Role;           // quem está declarando (lider|desafiante)
  vencedor: Vencedor;   // quem venceu (lider|desafiante)
  temporadaAtiva?: TemporadaAtiva;
  temporada?: TemporadaAtiva;       // alias suportado
  callerUid?: string;
}): Promise<FechamentoResultado> {
  const { db, desafioId, role, vencedor } = opts;
  const temp: TemporadaAtiva = opts.temporadaAtiva ?? opts.temporada ?? null;

  const ref = doc(db, "desafios_ginasio", desafioId);

  // 1) Transação: grava meu resultado e, se possível, fecha
  const txResult = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Desafio inexistente");
    const d = snap.data() as any;

    if (d.status === "concluido" || d.status === "conflito") {
      return { closed: false, status: d.status, desafio: d } as FechamentoResultado;
    }

    const campo = role === "lider" ? "resultado_lider" : "resultado_desafiante";
    const atual = d[campo] ?? null;

    if (atual && atual !== vencedor) {
      // mantém o já declarado para evitar troca
    } else if (!atual) {
      tx.update(ref, { [campo]: vencedor });
      d[campo] = vencedor;
    }

    const rl = d.resultado_lider ?? null;
    const rd = d.resultado_desafiante ?? null;

    if (!rl || !rd) {
      return { closed: false, status: d.status, desafio: d } as FechamentoResultado;
    }

    if (rl === rd) {
      tx.update(ref, {
        status: "concluido",
        vencedor: rl,
        fechadoEm: serverTimestamp(),
      });
      return {
        closed: true,
        status: "concluido",
        vencedor: rl as Vencedor,
        desafio: { ...d, status: "concluido", vencedor: rl },
      } as FechamentoResultado;
    } else {
      tx.update(ref, { status: "conflito", fechadoEm: serverTimestamp() });
      return {
        closed: true,
        status: "conflito",
        desafio: { ...d, status: "conflito" },
      } as FechamentoResultado;
    }
  });

  // 2) Efeitos colaterais apenas se ESTE call fechou agora
  if (txResult.closed && txResult.status === "concluido") {
    const d = txResult.desafio;
    if (txResult.vencedor === "desafiante") {
      await efeitosVitoriaDesafiante(db, d, temp);
    } else {
      await efeitosVitoriaLider(db, d);
    }
  }

  if (txResult.closed && txResult.status === "conflito") {
    const d = txResult.desafio;
    await addDoc(collection(db, "alertas_conflito"), {
      desafio_id: ref.id,
      ginasio_id: d.ginasio_id,
      lider_uid: d.lider_uid,
      desafiante_uid: d.desafiante_uid,
      createdAt: Date.now(),
    });
  }

  return txResult;
}