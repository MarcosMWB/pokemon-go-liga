import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
export const ROLES = ["lider", "desafiante"] as const;
export type Role = (typeof ROLES)[number];
export type Vencedor = "lider" | "desafiante";

type CloseResult =
  | { closed: false }
  | { closed: true; status: "concluido" | "conflito" };

/**
 * Atualiza o resultado do usuário (lider/desafiante).
 * Se os dois resultados baterem, fecha o desafio (status=concluido) e define vencedor/vencedor_uid.
 *
 * OBS: Efeitos colaterais (stats, pontos Elite4, etc.) devem ser aplicados via Cloud Functions
 * para evitar problemas de permissão nas regras do Firestore (um usuário não pode atualizar o outro).
 */
export async function setResultadoEFecharSePossivel(
  db: Firestore,
  desafioId: string,
  actor: "lider" | "desafiante",
  resultado: "lider" | "desafiante",
  actorUid?: string | null
): Promise<CloseResult> {
  const ref = doc(db, "desafios_ginasio", desafioId);

  const snap = await getDoc(ref);
  if (!snap.exists()) return { closed: false };

  const d = snap.data() as any;
  if (d.status === "concluido" || d.status === "conflito") return { closed: false };

  const isLider = actor === "lider";
  const myField = isLider ? "resultado_lider" : "resultado_desafiante";

  // fase A: grava meu resultado (se necessário)
  if (d[myField] !== resultado) {
    await updateDoc(ref, {
      [myField]: resultado,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid || null,
      lastActivityAt: serverTimestamp(),
    } as any);
  }

  // fase B: re-lê e fecha se possível
  const snap2 = await getDoc(ref);
  if (!snap2.exists()) return { closed: false };
  const d2 = snap2.data() as any;

  const rl = d2.resultado_lider;
  const rd = d2.resultado_desafiante;

  // ambos setados?
  if (!rl || !rd) return { closed: false };

  // concordaram: fecha concluído
  if (rl === rd) {
    const vencedor: "lider" | "desafiante" = rl;
    const vencedorUid =
      vencedor === "lider"
        ? String(d2.lider_uid || "")
        : String(d2.desafiante_uid || "");

    if (!vencedorUid) return { closed: false };

    await updateDoc(ref, {
      status: "concluido",
      vencedor,
      vencedor_uid: vencedorUid,
      fechadoEm: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: actorUid || null,
      lastActivityAt: serverTimestamp(),
    } as any);

    return { closed: true, status: "concluido" };
  }

  // discordaram: fecha conflito
  await updateDoc(ref, {
    status: "conflito",
    fechadoEm: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: actorUid || null,
    lastActivityAt: serverTimestamp(),
  } as any);

  return { closed: true, status: "conflito" };
}