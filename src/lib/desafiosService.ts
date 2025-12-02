// src/lib/desafiosService.ts
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
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

export type FechamentoResultado =
  | { closed: false; status?: string; desafio?: any }
  | { closed: true; status: "concluido" | "conflito"; vencedor?: Vencedor; desafio: any };

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

// ======= VITÓRIA DO LÍDER (idempotente, com dedupe por desafio) =======
async function efeitosVitoriaLider(
  db: Firestore,
  d: any,
  callerUid?: string | null,
  desafioId?: string
) {
  const gRef = doc(db, "ginasios", d.ginasio_id);
  const liderRef = doc(db, "usuarios", d.lider_uid);

  // quem PODE atualizar o ginásio pelas regras? o LÍDER atual
  if (callerUid === d.lider_uid) {
    try { await updateDoc(gRef, { derrotas_seguidas: 0 }); } catch { }

    // Elite4 points pro líder (só o próprio pode criar/alterar o participante)
    try {
      const liderSnap = await getDoc(liderRef);
      const ls = liderSnap.exists() ? (liderSnap.data() as any) : {};
      const w = asInt(ls?.statsvitorias);
      const l = asInt(ls?.statsderrotas);
      const pts = calcElite4Points(w, l);

      let liga: string = d.liga || "";
      if (!liga) {
        const gSnap = await getDoc(gRef);
        liga = gSnap.exists() ? ((gSnap.data() as any).liga || "") : "";
      }
      const elite4Id = liga ? await getElite4CampeonatoAtivoId(db, liga) : null;
      if (elite4Id && pts > 0) {
        const partRef = doc(db, "campeonatos_elite4", elite4Id, "participantes", d.lider_uid);

        // garante doc + campos base
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

        // dedupe por desafioId (evita pontos em duplicidade)
        if (desafioId) {
          const partSnap = await getDoc(partRef);
          const pdata = partSnap.exists() ? (partSnap.data() as any) : {};
          const already = pdata?.wins_applied?.[desafioId] === true;
          if (already) return;

          await updateDoc(partRef, {
            pontos: increment(pts),
            [`wins_applied.${desafioId}`]: true,
            updatedAt: serverTimestamp(),
          } as any);
        } else {
          // sem id do desafio: aplica mesmo assim (não recomendado)
          await updateDoc(partRef, { pontos: increment(pts), updatedAt: serverTimestamp() } as any);
        }
      }
    } catch { }
  }

  // quem PODE atualizar stats do desafiante? o PRÓPRIO desafiante
  if (callerUid === d.desafiante_uid) {
    try { await updateDoc(liderRef, { statsderrotas: increment(1) }); } catch { }
  }

  // bloqueio — permitido a qualquer autenticado
  try {
    await addDoc(collection(db, "bloqueios_ginasio"), {
      ginasio_id: d.ginasio_id,
      desafiante_uid: d.desafiante_uid,
      proximo_desafio: Date.now() + 15 * 24 * 60 * 60 * 1000,
      createdAt: serverTimestamp(),
    });
  } catch { }
}

async function resetElite4PontuacaoDoUsuario(
  db: Firestore,
  userUid: string,
  ginasioId?: string,
  motivo?: "renuncia" | "3_derrotas",
  ligaParam?: string
) {
  if (!userUid) return;

  // resolve liga
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

// ======= VITÓRIA DO DESAFIANTE =======
async function efeitosVitoriaDesafiante(
  db: Firestore,
  d: any,
  temp: TemporadaAtiva,
  callerUid?: string | null
) {
  const gRef = doc(db, "ginasios", d.ginasio_id);
  const gSnap = await getDoc(gRef);
  const g = gSnap.exists() ? (gSnap.data() as any) : null;

  // quem PODE criar insígnia e atualizar suas stats? o PRÓPRIO desafiante
  if (callerUid === d.desafiante_uid) {
    try {
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
    } catch { }

    try { await updateDoc(doc(db, "usuarios", d.desafiante_uid), { statsvitorias: increment(1) }); } catch { }

    try {
      await addDoc(collection(db, "bloqueios_ginasio"), {
        ginasio_id: d.ginasio_id,
        desafiante_uid: d.desafiante_uid,
        proximo_desafio: Date.now() + 7 * 24 * 60 * 60 * 1000,
        createdAt: serverTimestamp(),
      });
    } catch { }
  }

  // quem PODE mexer no ginásio/reset Elite4 do líder? o LÍDER (ainda é o líder nas regras)
  if (callerUid === d.lider_uid && gSnap.exists()) {
    try {
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
          try {
            await resetElite4PontuacaoDoUsuario(db, g.lider_uid, d.ginasio_id, "3_derrotas", g?.liga || d.liga || "");
          } catch { }
        }
      } else {
        await updateDoc(gRef, { derrotas_seguidas: derrotas });
      }
    } catch { }
  }
}

/**
 * Marca o resultado do "meu lado" e, se ambos já declararam, fecha (concluido/conflito).
 * Efeitos colaterais só rodam quando ESTE call fechou agora.
 */
export async function setResultadoEFecharSePossivel(opts: {
  db: Firestore;
  desafioId: string;
  role: "lider" | "desafiante";
  vencedor: "lider" | "desafiante";
  temporadaAtiva?: { id?: string; nome?: string } | null;
  temporada?: { id?: string; nome?: string } | null;
  callerUid?: string | null;
}): Promise<FechamentoResultado> {
  const { db, desafioId, role, vencedor } = opts;
  const temp: TemporadaAtiva = opts.temporadaAtiva ?? opts.temporada ?? null;
  const callerUid = opts.callerUid ?? null;

  const ref = doc(db, "desafios_ginasio", desafioId);

  // FASE A: grava SOMENTE meu resultado
  const campo = role === "lider" ? "resultado_lider" : "resultado_desafiante";
  try {
    await updateDoc(ref, { [campo]: vencedor } as any);
  } catch {
    throw new Error("perm:set-resultado");
  }

  // Lê estado atual
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Desafio inexistente");
  const d = snap.data() as any;

  const rl = d.resultado_lider ?? null;
  const rd = d.resultado_desafiante ?? null;

  // Ainda falta o outro declarar
  if (!rl || !rd) return { closed: false, status: d.status, desafio: d };

  // FASE B: fechar
  if (rl === rd) {
    const vencedorUid = rl === "lider" ? d.lider_uid : d.desafiante_uid;
    try {
      await updateDoc(ref, {
        status: "concluido",
        vencedor: rl,
        vencedor_uid: vencedorUid,
        fechadoEm: serverTimestamp(),
      } as any);
    } catch {
      throw new Error("perm:close-concordante");
    }

    // efeitos — só quando ESTE call fechou
    try {
      if (rl === "desafiante") {
        await efeitosVitoriaDesafiante(db, { ...d, vencedor: rl }, temp, callerUid);
      } else {
        await efeitosVitoriaLider(db, { ...d, vencedor: rl }, callerUid, ref.id);
      }
    } catch { }

    return {
      closed: true,
      status: "concluido",
      vencedor: rl as Vencedor,
      desafio: { ...d, status: "concluido", vencedor: rl, vencedor_uid: vencedorUid },
    };
  } else {
    try {
      await updateDoc(ref, { status: "conflito", fechadoEm: serverTimestamp() } as any);
    } catch {
      throw new Error("perm:close-conflito");
    }

    try {
      await addDoc(collection(db, "alertas_conflito"), {
        desafio_id: ref.id,
        ginasio_id: d.ginasio_id,
        lider_uid: d.lider_uid,
        desafiante_uid: d.desafiante_uid,
        createdAt: Date.now(),
      });
    } catch { }

    return { closed: true, status: "conflito", desafio: { ...d, status: "conflito" } };
  }
}

/**
 * Garantia pós-fechamento (sem mexer em regras):
 * Se eu sou o vencedor legítimo segundo as regras (logo tenho permissão),
 * reaplico efeitos idempotentes (com dedupe).
 */
export async function garantirEfeitosPosConclusao(opts: {
  db: Firestore;
  desafioId: string;
  callerUid: string | null;
  temporadaAtiva?: TemporadaAtiva;
  temporada?: TemporadaAtiva;
}): Promise<void> {
  const { db, desafioId } = opts;
  const callerUid = opts.callerUid ?? null;
  const temp: TemporadaAtiva = opts.temporadaAtiva ?? opts.temporada ?? null;

  const ref = doc(db, "desafios_ginasio", desafioId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  const d = snap.data() as any;
  if (d.status !== "concluido") return;

  const vencedor: Vencedor | undefined = d.vencedor;
  if (vencedor === "lider" && callerUid === d.lider_uid) {
    // idempotente: usa wins_applied.{desafioId}
    await efeitosVitoriaLider(db, d, callerUid, desafioId);
  } else if (vencedor === "desafiante" && callerUid === d.desafiante_uid) {
    await efeitosVitoriaDesafiante(db, d, temp, callerUid);
  }
}
