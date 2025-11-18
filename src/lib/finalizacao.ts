import { auth, db } from "@/lib/firebase";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  updateDoc,
  where,
  limit,
} from "firebase/firestore";

// Helpers compartilhados
export async function purgeDisputa(disputaId: string) {
  // participantes
  const pSnap = await getDocs(
    query(
      collection(db, "disputas_ginasio_participantes"),
      where("disputa_id", "==", disputaId)
    )
  );
  for (const d of pSnap.docs) {
    try {
      await deleteDoc(d.ref);
    } catch {
      await updateDoc(d.ref, { removido: true });
    }
  }

  // resultados
  const rSnap = await getDocs(
    query(
      collection(db, "disputas_ginasio_resultados"),
      where("disputa_id", "==", disputaId)
    )
  );
  for (const d of rSnap.docs) {
    try {
      await deleteDoc(d.ref);
    } catch {
      await updateDoc(d.ref, { status: "limpo" });
    }
  }

  // disputa
  const dRef = doc(db, "disputas_ginasio", disputaId);
  try {
    await deleteDoc(dRef);
  } catch {
    await updateDoc(dRef, {
      status: "finalizado",
      encerradaEm: Date.now(),
      purgada: true,
    });
  }
}

export async function closeAndPurgeActiveDisputes(ginasioId: string) {
  const snap = await getDocs(
    query(
      collection(db, "disputas_ginasio"),
      where("ginasio_id", "==", ginasioId),
      where("status", "in", ["inscricoes", "batalhando"])
    )
  );
  for (const d of snap.docs) {
    await purgeDisputa(d.id);
  }
}

export async function endActiveLeadership(ginasioId: string) {
  const snap = await getDocs(
    query(
      collection(db, "ginasios_liderancas"),
      where("ginasio_id", "==", ginasioId),
      where("endedAt", "==", null)
    )
  );
  for (const d of snap.docs) {
    await updateDoc(d.ref, {
      endedAt: Date.now(),
      endedByAdminUid: auth.currentUser?.uid || null,
    });
  }
}

// Ranking a partir de resultados confirmados
function computarPontos(participantes: Array<{ usuario_uid: string }>, resultados: any[]) {
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
}

async function assertIsSuper() {
  const u = auth.currentUser;
  if (!u) throw new Error("Sem usuário autenticado.");
  const sup = await getDoc(doc(db, "superusers", u.uid));
  if (!sup.exists()) throw new Error("Ação restrita a administradores.");
  return u.uid;
}

async function findDisputaMaisRecente(ginasioId: string) {
  const snap = await getDocs(
    query(
      collection(db, "disputas_ginasio"),
      where("ginasio_id", "==", ginasioId),
      orderBy("createdAt", "desc"),
      limit(1)
    )
  );
  return snap.empty ? null : { id: snap.docs[0].id, data: snap.docs[0].data() as any };
}

export async function aplicarFinalizacaoDeDisputa(
  ginasioId: string,
  opts?: { purgeAfter?: boolean }
) {
  const adminUid = await assertIsSuper();

  const disputa = await findDisputaMaisRecente(ginasioId);
  if (!disputa) throw new Error("Nenhuma disputa encontrada para este ginásio.");

  const disputaId = disputa.id;

  // Carregar participantes (ativos)
  const pSnap = await getDocs(
    query(
      collection(db, "disputas_ginasio_participantes"),
      where("disputa_id", "==", disputaId)
    )
  );
  const participantes = pSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as any) }))
    .filter((p) => p.removido !== true);

  // Carregar resultados
  const rSnap = await getDocs(
    query(
      collection(db, "disputas_ginasio_resultados"),
      where("disputa_id", "==", disputaId)
    )
  );
  const resultados = rSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

  // Ranking
  const pontos = computarPontos(participantes, resultados);
  const ranking = [...participantes].sort(
    (a, b) => (pontos[b.usuario_uid] || 0) - (pontos[a.usuario_uid] || 0)
  );

  if (ranking.length === 0) {
    // Sem inscritos ou sem pontuação: apenas marca finalizado e encerra/purga se pedido
    await updateDoc(doc(db, "disputas_ginasio", disputaId), {
      status: "finalizado",
      finalizacao_aplicada: true,
      vencedor_uid: "",
      aplicado_em: Date.now(),
      aplicadoPorAdminUid: adminUid,
      empate_no_topo: false,
    });
    if (opts?.purgeAfter) await purgeDisputa(disputaId);
    return { vencedor: null, motivo: "sem_participantes" };
  }

  const top = ranking[0];
  const topoPts = pontos[top.usuario_uid] || 0;
  const empatadosTopo = ranking.filter((p) => (pontos[p.usuario_uid] || 0) === topoPts);

  if (empatadosTopo.length > 1) {
    await updateDoc(doc(db, "disputas_ginasio", disputaId), {
      status: "finalizado",
      empate_no_topo: true,
      finalizacao_aplicada: false,
      tentativa_finalizacao_em: Date.now(),
    });
    throw new Error("Empate no topo. Resolva manualmente.");
  }

  const gRef = doc(db, "ginasios", ginasioId);
  const gSnap = await getDoc(gRef);
  const gData = gSnap.exists() ? (gSnap.data() as any) : {};

  const tipoNovo =
    top.tipo_escolhido || gData.tipo || disputa.data?.tipo_original || "";
  const ligaDoGinasio =
    gData.liga || disputa.data?.liga || disputa.data?.liga_nome || "";

  // Encerrar liderança ativa (se houver)
  await endActiveLeadership(ginasioId);

  // Atualizar ginásio
  await updateDoc(gRef, {
    lider_uid: top.usuario_uid,
    tipo: tipoNovo,
    em_disputa: false,
    derrotas_seguidas: 0,
  });

  // Evitar duplicar ginasios_liderancas: só cria se não existir ativa para este líder
  const jaAtivaSnap = await getDocs(
    query(
      collection(db, "ginasios_liderancas"),
      where("ginasio_id", "==", ginasioId),
      where("lider_uid", "==", top.usuario_uid),
      where("endedAt", "==", null)
    )
  );
  if (jaAtivaSnap.empty) {
    await addDoc(collection(db, "ginasios_liderancas"), {
      ginasio_id: ginasioId,
      lider_uid: top.usuario_uid,
      startedAt: Date.now(),
      endedAt: null,
      origem: "disputa",
      liga: ligaDoGinasio || "",
      temporada_id: disputa.data?.temporada_id || "",
      temporada_nome: disputa.data?.temporada_nome || "",
      tipo_no_periodo: tipoNovo || "",
      createdByAdminUid: adminUid,
      endedByAdminUid: null,
    });
  }

  // Marcar disputa como aplicada
  await updateDoc(doc(db, "disputas_ginasio", disputaId), {
    status: "finalizado",
    finalizacao_aplicada: true,
    vencedor_uid: top.usuario_uid,
    aplicado_em: Date.now(),
    aplicadoPorAdminUid: adminUid,
    empate_no_topo: false,
  });

  if (opts?.purgeAfter) {
    await purgeDisputa(disputaId);
  }

  return { vencedor: top.usuario_uid, tipoNovo };
}
