// src/app/dev/conflitos/page.tsx
"use client";

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
  getDocs,
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

  // Auth + superuser
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      const qSup = query(
        collection(db, "superusers"),
        where("uid", "==", user.uid)
      );
      const snap = await getDocs(qSup);
      if (snap.empty) {
        setIsAdmin(false);
        router.replace("/");
        return;
      }
      setIsAdmin(true);
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

  if (isAdmin === null) return <p className="p-6">Carregando…</p>;
  if (isAdmin === false) return null;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dev / Conflitos</h1>
          <p className="text-sm text-gray-500">
            Interpretação de conflitos e pendentes +7 dias.
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
        <h2 className="text-xl font-semibold">Conflitos</h2>
        {conflitos.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum conflito no momento.</p>
        ) : (
          conflitos.map((d) => {
            const desafiante = userNameMap[d.desafiante_uid] || d.desafiante_uid;
            const lider = userNameMap[d.lider_uid] || d.lider_uid;
            const ginasio = ginasioNameMap[d.ginasio_id] || d.ginasio_id;

            // Frase explicativa
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
                className="bg-white rounded shadow p-4 flex items-center justify-between"
              >
                <div className="space-y-1">
                  <p className="text-sm">
                    <strong>{desafiante}</strong> {parteDesafiante}, mas{" "}
                    <strong>{lider}</strong> {parteLider}.
                  </p>
                  <p className="text-xs text-gray-500">
                    Ginásio: {ginasio} • Criado {tempoRelativo(d.criadoEmMs)}
                  </p>
                  <p className="text-xs text-gray-400">ID desafio: {d.id}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      router.push(`/ginasios/${d.ginasio_id}/disputa`)
                    }
                    className="px-3 py-1 rounded bg-blue-600 text-white text-sm"
                  >
                    Abrir disputa
                  </button>
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
                <div className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      router.push(`/ginasios/${d.ginasio_id}/disputa`)
                    }
                    className="px-3 py-1 rounded bg-blue-600 text-white text-sm"
                  >
                    Abrir disputa
                  </button>
                </div>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
