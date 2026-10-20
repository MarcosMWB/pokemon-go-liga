// src/app/dev/conflitos/page.tsx
"use client";

import type { User } from "firebase/auth";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  onSnapshot,
  getDoc,
  doc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

type Desafio = {
  id: string;
  ginasio_id: string;
  lider_uid: string;
  desafiante_uid: string;
  status: "pendente" | "conflito" | "concluido";
  criadoEmMs: number | null;
  resultado_lider?: "lider" | "desafiante";
  resultado_desafiante?: "lider" | "desafiante";
};

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

function tempoRelativo(ms?: number | null) {
  if (!ms) return "há tempo indeterminado";
  const diff = Date.now() - ms;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `há ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}

export default function DevConflitosPage() {
  const router = useRouter();

  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [conflitos, setConflitos] = useState<Desafio[]>([]);
  const [pendentes, setPendentes] = useState<Desafio[]>([]);
  const [userNameMap, setUserNameMap] = useState<Record<string, string>>({});
  const [ginasioNameMap, setGinasioNameMap] = useState<Record<string, string>>({});
  const [resolvendoId, setResolvendoId] = useState<string | null>(null);
  const [resolucaoFeedback, setResolucaoFeedback] = useState<{ id: string; texto: string; erro?: boolean } | null>(null);

  // Auth + superuser
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (current: User | null) => {
      if (!current) {
        router.replace("/login");
        return;
      }

      try {
        const snap = await getDoc(doc(db, "superusers", current.uid));
        if (!snap.exists()) {
          setIsAdmin(false);
          router.replace("/");
          return;
        }
        setIsAdmin(true);
      } catch {
        setIsAdmin(false);
        router.replace("/");
      }
    });

    return () => unsub();
  }, [router]);

  // Snapshot: conflitos
  useEffect(() => {
    if (isAdmin !== true) return;

    const qConf = query(
      collection(db, "desafios_ginasio"),
      where("status", "==", "conflito")
    );

    const unsub = onSnapshot(qConf, (snap) => {
      const list: Desafio[] = snap.docs.filter((d) => !d.data().disputa_id).map((d) => {
        const x = d.data() as any;
        const created = toMillis(
          x.criadoEm ?? x.createdAt ?? x.criado_em ?? x.created_at
        );
        return {
          id: d.id,
          ginasio_id: x.ginasio_id,
          lider_uid: x.lider_uid,
          desafiante_uid: x.desafiante_uid,
          status: x.status,
          criadoEmMs: created,
          resultado_lider: x.resultado_lider,
          resultado_desafiante: x.resultado_desafiante,
        };
      });
      setConflitos(list);
    });

    return () => unsub();
  }, [isAdmin]);

  // Snapshot: pendentes
  useEffect(() => {
    if (isAdmin !== true) return;

    const qPend = query(
      collection(db, "desafios_ginasio"),
      where("status", "==", "pendente")
    );

    const unsub = onSnapshot(qPend, (snap) => {
      const list: Desafio[] = snap.docs.map((d) => {
        const x = d.data() as any;
        const created = toMillis(
          x.criadoEm ?? x.createdAt ?? x.criado_em ?? x.created_at
        );
        return {
          id: d.id,
          ginasio_id: x.ginasio_id,
          lider_uid: x.lider_uid,
          desafiante_uid: x.desafiante_uid,
          status: x.status,
          criadoEmMs: created,
        };
      });
      setPendentes(list);
    });

    return () => unsub();
  }, [isAdmin]);

  // Resolver nomes (usuários e ginásios) quando listas mudarem
  useEffect(() => {
    if (isAdmin !== true) return;

    const all = [...conflitos, ...pendentes];

    const uids = Array.from(
      new Set(
        all.flatMap((d) => [d.lider_uid, d.desafiante_uid]).filter(Boolean)
      )
    ) as string[];

    const ginasioIds = Array.from(
      new Set(all.map((d) => d.ginasio_id).filter(Boolean))
    ) as string[];

    (async () => {
      const newUserMap: Record<string, string> = { ...userNameMap };
      const newGymMap: Record<string, string> = { ...ginasioNameMap };

      // usuários
      await Promise.all(
        uids.map(async (uid) => {
          if (newUserMap[uid]) return;
          const u = await getDoc(doc(db, "usuarios", uid));
          if (u.exists()) {
            const ud = u.data() as any;
            newUserMap[uid] = ud.nome || ud.email || uid;
          } else {
            newUserMap[uid] = uid;
          }
        })
      );

      // ginásios
      await Promise.all(
        ginasioIds.map(async (gid) => {
          if (newGymMap[gid]) return;
          const g = await getDoc(doc(db, "ginasios", gid));
          if (g.exists()) {
            const gd = g.data() as any;
            newGymMap[gid] = gd.nome || gid;
          } else {
            newGymMap[gid] = gid;
          }
        })
      );

      setUserNameMap(newUserMap);
      setGinasioNameMap(newGymMap);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflitos, pendentes, isAdmin]);

  const pendentesAtrasados = useMemo(() => {
    const limite = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return pendentes.filter((d) => (d.criadoEmMs ?? 0) < limite);
  }, [pendentes]);

  async function resolverConflito(desafio: Desafio, vencedor: "lider" | "desafiante" | null) {
    const currentUser = auth.currentUser;
    if (!currentUser || resolvendoId) return;

    const nomeVencedor = vencedor === "lider"
      ? userNameMap[desafio.lider_uid] || "o líder"
      : vencedor === "desafiante"
        ? userNameMap[desafio.desafiante_uid] || "o desafiante"
        : null;
    const acao = vencedor
      ? `registrar a vitória para ${nomeVencedor}`
      : "anular o desafio, sem vencedor, insígnia, derrota ou bloqueio de novo desafio";
    if (!window.confirm(`Confirma ${acao}? Essa decisão será aplicada ao desafio.`)) return;

    setResolvendoId(desafio.id);
    setResolucaoFeedback(null);
    try {
      await runTransaction(db, async (transaction) => {
        const ref = doc(db, "desafios_ginasio", desafio.id);
        const snap = await transaction.get(ref);
        if (!snap.exists() || snap.data().status !== "conflito") {
          throw new Error("Este conflito já foi resolvido ou não está mais disponível.");
        }
        const atual = snap.data();
        if (atual.disputa_id) {
          throw new Error("Este registro pertence a uma disputa interna e não pode ser resolvido por aqui.");
        }
        if (atual.statsApplied === true) {
          throw new Error("Este desafio já teve os efeitos aplicados. Verifique o histórico antes de alterar.");
        }

        const bloqueioRef = doc(db, "bloqueios_ginasio", `${atual.ginasio_id}__${atual.desafiante_uid}`);
        const bloqueioSnap = vencedor ? null : await transaction.get(bloqueioRef);

        const comum = {
          relato_lider_original: atual.resultado_lider ?? null,
          relato_desafiante_original: atual.resultado_desafiante ?? null,
          resolvidoPorUid: currentUser.uid,
          resolvidoEm: serverTimestamp(),
          fechadoEm: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: currentUser.uid,
        };

        if (vencedor) {
          transaction.update(ref, {
            ...comum,
            status: "concluido",
            resultado_lider: vencedor,
            resultado_desafiante: vencedor,
            vencedor,
            vencedor_uid: vencedor === "lider" ? atual.lider_uid : atual.desafiante_uid,
            encerramento_motivo: "decisao_admin_conflito",
          });
        } else {
          transaction.update(ref, {
            ...comum,
            status: "encerrado_sem_resultado",
            encerramento_motivo: "anulado_admin",
            canceladoPorUid: currentUser.uid,
          });
          if (bloqueioSnap?.exists() && bloqueioSnap.data().desafio_id === desafio.id) {
            transaction.delete(bloqueioRef);
          }
        }
      });

      setResolucaoFeedback({
        id: desafio.id,
        texto: vencedor
          ? `Vitória de ${nomeVencedor} registrada. O sistema atualizará os pontos e a insígnia, quando aplicável.`
          : "Desafio anulado. Nenhuma vitória, insígnia ou derrota será aplicada, e o bloqueio deste desafio foi removido.",
      });
    } catch (error) {
      const texto = error instanceof Error ? error.message : "Não foi possível resolver este conflito.";
      setResolucaoFeedback({ id: desafio.id, texto, erro: true });
    } finally {
      setResolvendoId(null);
    }
  }

  if (isAdmin === null) return <p className="p-6">Carregando…</p>;
  if (isAdmin === false) return null;

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-6 sm:px-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Análise de desafios</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Compare o relato dos dois jogadores e registre a decisão administrativa. Se não houver acordo, você também pode anular o desafio.
          </p>
        </div>
        <button
          onClick={() => router.push("/dev")}
          className="text-sm text-blue-600 underline"
        >
          Voltar ao painel
        </button>
      </div>

      {/* Conflitos */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">Desafios com relatos diferentes</h2>
        {resolucaoFeedback && (
          <p role="status" className={`rounded-xl px-4 py-3 text-sm ${resolucaoFeedback.erro ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}>
            {resolucaoFeedback.texto}
          </p>
        )}
        {conflitos.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum conflito no momento.</p>
        ) : (
          conflitos.map((d) => {
            const desafiante = userNameMap[d.desafiante_uid] || d.desafiante_uid;
            const lider = userNameMap[d.lider_uid] || d.lider_uid;
            const ginasio = ginasioNameMap[d.ginasio_id] || d.ginasio_id;

            const parteDesafiante =
              d.resultado_desafiante === "desafiante"
                ? "disse que ele venceu"
                : "disse que o líder venceu";

            const parteLider =
              d.resultado_lider === "lider"
                ? "disse que ele venceu"
                : "disse que o desafiante venceu";

            return (
              <div
                key={d.id}
                className="space-y-4 rounded-2xl border border-amber-200 bg-white p-4 shadow-sm sm:p-5"
              >
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">Precisa de decisão</span>
                    <span className="text-sm text-slate-600">Ginásio: <strong className="text-slate-900">{ginasio}</strong> · {tempoRelativo(d.criadoEmMs)}</span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Relato do desafiante</p>
                      <p className="mt-1 text-sm text-slate-800"><strong>{desafiante}</strong> {parteDesafiante}.</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Relato do líder</p>
                      <p className="mt-1 text-sm text-slate-800"><strong>{lider}</strong> {parteLider}.</p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400">Referência do desafio: {d.id}</p>
                </div>
                <div className="flex flex-col gap-2 border-t border-slate-100 pt-4">
                  <p className="text-sm font-semibold text-slate-800">Como deseja resolver?</p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <button
                    disabled={resolvendoId !== null}
                    onClick={() => void resolverConflito(d, "lider")}
                    className="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-wait disabled:opacity-60"
                  >
                    {resolvendoId === d.id ? "Salvando…" : `Dar vitória ao líder · ${lider}`}
                  </button>
                  <button
                    disabled={resolvendoId !== null}
                    onClick={() => void resolverConflito(d, "desafiante")}
                    className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-wait disabled:opacity-60"
                  >
                    {resolvendoId === d.id ? "Salvando…" : `Dar vitória ao desafiante · ${desafiante}`}
                  </button>
                  <button
                    disabled={resolvendoId !== null}
                    onClick={() => void resolverConflito(d, null)}
                    className="rounded-xl border border-rose-300 bg-white px-4 py-2.5 text-sm font-semibold text-rose-800 hover:bg-rose-50 disabled:cursor-wait disabled:opacity-60"
                  >
                    Anular desafio
                  </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </section>

      {/* Pendentes > 7 dias */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Pendentes há mais de 7 dias</h2>
        {pendentesAtrasados.length === 0 ? (
          <p className="text-sm text-gray-500">
            Nenhum desafio pendente acima de 7 dias.
          </p>
        ) : (
          pendentesAtrasados.map((d) => {
            const desafiante = userNameMap[d.desafiante_uid] || d.desafiante_uid;
            const lider = userNameMap[d.lider_uid] || d.lider_uid;
            const ginasio = ginasioNameMap[d.ginasio_id] || d.ginasio_id;

            return (
              <div
                key={d.id}
                className="bg-white rounded shadow p-4 flex items-center justify-between"
              >
                <div className="space-y-1">
                  <p className="text-sm">
                    Pendente entre <strong>{desafiante}</strong> e{" "}
                    <strong>{lider}</strong> no ginásio <strong>{ginasio}</strong>.
                  </p>
                  <p className="text-xs text-gray-500">
                    Criado {tempoRelativo(d.criadoEmMs)}
                  </p>
                  <p className="text-xs text-gray-400">ID desafio: {d.id}</p>
                </div>
                <div className="text-sm text-slate-600">
                  O prazo expirado será encerrado automaticamente pelo sistema.
                </div>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
