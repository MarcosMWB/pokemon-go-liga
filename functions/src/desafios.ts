// functions/src/desafios.ts
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { admin, db, FieldValue } from "./adminSdk";

/**
 * Helpers de configuração
 */
function minutesToMs(n: number): number {
  return Math.max(0, Math.floor(n)) * 60 * 1000;
}

async function getBloqueioDesafioMs(): Promise<number> {
  try {
    const snap = await db.collection("variables").doc("global").get();
    if (!snap.exists) return minutesToMs(30); // padrão 30min
    const raw = (snap.data() as any)?.bloqueio_desafio_minutos;
    const n =
      typeof raw === "number"
        ? raw
        : typeof raw === "string"
        ? parseFloat(raw.trim().replace(",", "."))
        : NaN;
    return Number.isFinite(n) ? minutesToMs(n) : minutesToMs(30);
  } catch {
    return minutesToMs(30);
  }
}

/**
 * Extrai campos relevantes de um doc de resultado de desafio.
 * Estrutura esperada (flexível e tolerante a faltas):
 *  - ginasio_id: string
 *  - lider_uid: string
 *  - desafiante_uid: string
 *  - status: "pendente" | "confirmado" | ...
 *  - tipo: "vitoria_lider" | "vitoria_desafiante" | "empate" | ...
 *  - vencedor_uid, perdedor_uid: string (se houver)
 */
type ResultadoDesafio = {
  id?: string;
  ginasio_id?: string;
  lider_uid?: string;
  desafiante_uid?: string;
  status?: string;
  tipo?: string;
  vencedor_uid?: string | null;
  perdedor_uid?: string | null;
  processadoEm?: FirebaseFirestore.FieldValue | number | null;
};

function normStr(v: unknown): string {
  return (typeof v === "string" ? v : "").trim();
}

function safeData(d: FirebaseFirestore.DocumentData | undefined): ResultadoDesafio {
  const o = (d || {}) as any;
  return {
    ginasio_id: normStr(o.ginasio_id),
    lider_uid: normStr(o.lider_uid),
    desafiante_uid: normStr(o.desafiante_uid),
    status: normStr(o.status).toLowerCase(),
    tipo: normStr(o.tipo).toLowerCase(),
    vencedor_uid: o.vencedor_uid ? String(o.vencedor_uid) : null,
    perdedor_uid: o.perdedor_uid ? String(o.perdedor_uid) : null,
    processadoEm: o.processadoEm ?? null,
  };
}

/**
 * Decide se devemos executar efeitos colaterais neste write:
 *  - Somente quando o AFTER existir e estiver em status "confirmado"
 *  - E ainda não tiver sido processado anteriormente (campo processadoEm ausente)
 */
function deveProcessarResultado(before: ResultadoDesafio | null, after: ResultadoDesafio | null): boolean {
  if (!after) return false; // deletou
  if (after.status !== "confirmado") return false;

  // idempotência: se já tiver processado, não repete
  // (considerando que processadoEm é escrito no fim)
  // se o before já tinha processadoEm, provavelmente já passou aqui.
  const beforeProcessed =
    before && (before.processadoEm !== undefined && before.processadoEm !== null);
  const afterProcessed =
    after && (after.processadoEm !== undefined && after.processadoEm !== null);

  if (afterProcessed) return false;
  if (beforeProcessed) return false;

  return true;
}

/**
 * Monta a chave de bloqueio (pareamento) estável para o par.
 */
function makePairKey(a: string, b: string): string {
  return [a, b].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)).join("__");
}

/**
 * Efeito: cria/renova bloqueio entre o par no ginásio.
 * Retorna o docRef do bloqueio gravado.
 */
async function upsertBloqueioDesafio(params: {
  ginasioId: string;
  liderUid: string;
  desafianteUid: string;
  expiresAtMs: number;
  resultadoId: string;
  motivo: string;
}) {
  const { ginasioId, liderUid, desafianteUid, expiresAtMs, resultadoId, motivo } = params;
  const pairKey = makePairKey(liderUid, desafianteUid);
  const bloqueioId = `${ginasioId}__${pairKey}`;

  const ref = db.collection("bloqueios_desafio").doc(bloqueioId);
  await ref.set(
    {
      ginasio_id: ginasioId,
      lider_uid: liderUid,
      desafiante_uid: desafianteUid,
      pairKey,
      expiresAtMs,
      motivo, // ex.: "resultado_confirmado"
      resultado_origem_id: resultadoId,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return ref;
}

/**
 * (Opcional) Log mínimo de auditoria para debug/admin
 */
async function logEventoDesafio(params: {
  ginasioId: string;
  resultadoId: string;
  tipo: string;
  vencedorUid: string | null;
  perdedorUid: string | null;
}) {
  const { ginasioId, resultadoId, tipo, vencedorUid, perdedorUid } = params;
  await db.collection("admin_eventos").add({
    type: "desafio_resultado_processado",
    ginasio_id: ginasioId,
    resultado_id: resultadoId,
    tipo,
    vencedor_uid: vencedorUid,
    perdedor_uid: perdedorUid,
    createdAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Trigger principal:
 * - Dispara em qualquer write de /desafios_resultados/{resultadoId}
 * - Quando o resultado fica "confirmado" pela primeira vez:
 *     1) Calcula/recupera duração do bloqueio (variables/global.bloqueio_desafio_minutos || 30)
 *     2) Upsert em /bloqueios_desafio/{ginasioId}__{pairKey}
 *     3) (GANHO DE PONTOS) – ponto de extensão se quiser atualizar stats
 *     4) Marca processadoEm no próprio resultado (idempotência)
 */
export const onDesafioResultadosWrite = onDocumentWritten(
  {
    document: "desafios_resultados/{resultadoId}",
    region: "southamerica-east1",
  },
  async (event) => {
    const resultadoId: string = event.params?.resultadoId ?? "";
    const beforeRaw = event.data?.before?.data();
    const afterRaw = event.data?.after?.data();

    const before = beforeRaw ? safeData(beforeRaw) : null;
    const after = afterRaw ? safeData(afterRaw) : null;

    if (!deveProcessarResultado(before, after)) {
      return;
    }

    // Segurança de campos obrigatórios
    const ginasioId = normStr(after?.ginasio_id);
    const liderUid = normStr(after?.lider_uid);
    const desafianteUid = normStr(after?.desafiante_uid);
    if (!ginasioId || !liderUid || !desafianteUid) {
      console.warn("Resultado confirmado sem campos básicos. Abortando.", {
        resultadoId,
        ginasioId,
        liderUid,
        desafianteUid,
      });
      return;
    }

    // Determina vencedor/perdedor de forma tolerante
    const tipo = normStr(after?.tipo); // "vitoria_lider" | "vitoria_desafiante" | "empate" | ...
    let vencedorUid: string | null = null;
    let perdedorUid: string | null = null;

    if (after?.vencedor_uid || after?.perdedor_uid) {
      vencedorUid = after?.vencedor_uid ? String(after.vencedor_uid) : null;
      perdedorUid = after?.perdedor_uid ? String(after.perdedor_uid) : null;
    } else {
      if (tipo === "vitoria_lider") {
        vencedorUid = liderUid;
        perdedorUid = desafianteUid;
      } else if (tipo === "vitoria_desafiante") {
        vencedorUid = desafianteUid;
        perdedorUid = liderUid;
      } else if (tipo === "empate") {
        vencedorUid = null;
        perdedorUid = null;
      }
    }

    // 1) Duração do bloqueio
    const bloqueioMs = await getBloqueioDesafioMs();
    const expiresAtMs = Date.now() + bloqueioMs;

    // 2) Upsert do bloqueio (mesmo em empate costumamos bloquear para evitar spam)
    await upsertBloqueioDesafio({
      ginasioId,
      liderUid,
      desafianteUid,
      expiresAtMs,
      resultadoId,
      motivo: "resultado_confirmado",
    });

    // 3) (GANHO DE PONTOS) – opcional.
    // Se quiser pontuar aqui, você pode:
    //  - Atualizar contadores em /usuarios/{uid} (vitorias/derrotas/empates)
    //  - Atualizar algum scoreboard por liga/ginasio
    // Exemplo simplificado (comentado):
    /*
    if (tipo === "vitoria_lider" && vencedorUid === liderUid) {
      await db.doc(`usuarios/${liderUid}`).set({ pts_lider: FieldValue.increment(1) }, { merge: true });
    } else if (tipo === "vitoria_desafiante" && vencedorUid === desafianteUid) {
      await db.doc(`usuarios/${desafianteUid}`).set({ pts_desafiante: FieldValue.increment(1) }, { merge: true });
    } else if (tipo === "empate") {
      // se quiser, some meio ponto pra cada, etc.
    }
    */

    // 4) Log mínimo de auditoria
    await logEventoDesafio({
      ginasioId,
      resultadoId,
      tipo,
      vencedorUid,
      perdedorUid,
    });

    // 5) Marca resultado como processado (idempotência)
    const resRef = db.collection("desafios_resultados").doc(resultadoId);
    await resRef.set({ processadoEm: FieldValue.serverTimestamp() }, { merge: true });
  }
);
