"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

type Desafio = {
  id: string;
  ginasio_id: string;
  lider_uid: string;
  desafiante_uid: string;
  status: "pendente" | "conflito" | "concluido";
  criadoEm?: number;
  resultado_lider?: "lider" | "desafiante";
  resultado_desafiante?: "lider" | "desafiante";
};

type GymInfo = { nome: string; liga?: string };
type UserInfo = { nome?: string; email?: string };

export default function DevConflitosPage() {
  const router = useRouter();

  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [conflitos, setConflitos] = useState<Desafio[]>([]);
  const [pendentes, setPendentes] = useState<Desafio[]>([]);
  const [gyms, setGyms] = useState<Record<string, GymInfo>>({});
  const [users, setUsers] = useState<Record<string, UserInfo>>({});

  // 1) Autenticação + verificação de superuser
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      const qSu = query(
        collection(db, "superusers"),
        where("uid", "==", user.uid)
      );
      const snap = await getDocs(qSu);
      if (snap.empty) {
        setIsAdmin(false);
        router.replace("/");
        return;
      }
      setIsAdmin(true);
    });
    return () => unsub();
  }, [router]);

  // 2) Streams: desafios em conflito e pendentes
  useEffect(() => {
    if (!isAdmin) return;

    // Conflitos
    const qConf = query(
      collection(db, "desafios_ginasio"),
      where("status", "==", "conflito")
    );
    const unsubConf = onSnapshot(qConf, (snap) => {
      const list: Desafio[] = snap.docs.map((d) => {
        const x = d.data() as any;
        return {
          id: d.id,
          ginasio_id: x.ginasio_id,
          lider_uid: x.lider_uid,
          desafiante_uid: x.desafiante_uid,
          status: x.status,
          criadoEm: x.criadoEm,
          resultado_lider: x.resultado_lider,
          resultado_desafiante: x.resultado_desafiante,
        };
      });
      setConflitos(list);
    });

    // Pendentes (vamos filtrar >7d no cliente)
    const qPend = query(
      collection(db, "desafios_ginasio"),
      where("status", "==", "pendente")
    );
    const unsubPend = onSnapshot(qPend, (snap) => {
      const list: Desafio[] = snap.docs.map((d) => {
        const x = d.data() as any;
        return {
          id: d.id,
          ginasio_id: x.ginasio_id,
          lider_uid: x.lider_uid,
          desafiante_uid: x.desafiante_uid,
          status: x.status,
          criadoEm: x.criadoEm,
        };
      });
      setPendentes(list);
    });

    return () => {
      unsubConf();
      unsubPend();
    };
  }, [isAdmin]);

  // 3) Carregar nomes de ginásios e usuários usados nos cards
  useEffect(() => {
    if (!isAdmin) return;

    const all = [...conflitos, ...pendentes];
    const gymIds = new Set<string>(all.map((d) => d.ginasio_id));
    const userIds = new Set<string>();
    all.forEach((d) => {
      userIds.add(d.lider_uid);
      userIds.add(d.desafiante_uid);
    });

    (async () => {
      // gyms que ainda não temos
      const toGetGyms = Array.from(gymIds).filter((id) => !(id in gyms));
      const newGyms: Record<string, GymInfo> = {};
      for (const gid of toGetGyms) {
        const gSnap = await getDoc(doc(db, "ginasios", gid));
        if (gSnap.exists()) {
          const g = gSnap.data() as any;
          newGyms[gid] = { nome: g.nome || gid, liga: g.liga || "" };
        } else {
          newGyms[gid] = { nome: gid };
        }
      }
      if (Object.keys(newGyms).length) {
        setGyms((prev) => ({ ...prev, ...newGyms }));
      }

      // users que ainda não temos
      const toGetUsers = Array.from(userIds).filter((id) => !(id in users));
      const newUsers: Record<string, UserInfo> = {};
      for (const uid of toGetUsers) {
        const uSnap = await getDoc(doc(db, "usuarios", uid));
        if (uSnap.exists()) {
          const u = uSnap.data() as any;
          newUsers[uid] = { nome: u.nome, email: u.email };
        } else {
          newUsers[uid] = {};
        }
      }
      if (Object.keys(newUsers).length) {
        setUsers((prev) => ({ ...prev, ...newUsers }));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflitos, pendentes, isAdmin]);

  // 4) Filtrar pendentes > 7 dias
  const pendentesAtrasados = useMemo(() => {
    const limite = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return pendentes.filter((d) => (d.criadoEm || 0) < limite);
  }, [pendentes]);

  if (isAdmin === null) return <p className="p-8">Carregando…</p>;
  if (isAdmin === false) return null;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="mb-2">
        <h1 className="text-2xl font-bold">DEV / Conflitos</h1>
        <p className="text-sm text-gray-500">
          Painel para interpretar desafios em conflito e pendências antigas.
        </p>
      </header>

      {/* CONFLITOS ATIVOS */}
      <section className="bg-white rounded shadow p-4">
        <h2 className="text-lg font-semibold mb-3">Conflitos ativos</h2>
        {conflitos.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum conflito no momento.</p>
        ) : (
          <ul className="space-y-3">
            {conflitos.map((d) => {
              const gym = gyms[d.ginasio_id];
              const desafiante = users[d.desafiante_uid];
              const lider = users[d.lider_uid];
              const resumo = interpreta(d.resultado_desafiante, d.resultado_lider);
              return (
                <li
                  key={d.id}
                  className="border rounded p-3 flex flex-col gap-2 bg-gray-50"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold">
                        {gym?.nome || d.ginasio_id}{" "}
                        {gym?.liga ? (
                          <span className="text-xs text-gray-500">({gym.liga})</span>
                        ) : null}
                      </p>
                      <p className="text-xs text-gray-500">
                        Desafio: <span className="font-mono">{d.id}</span>
                      </p>
                    </div>
                    <p className="text-xs text-gray-500">
                      Criado {tempoRelativo(d.criadoEm)}
                    </p>
                  </div>

                  <div className="text-sm">
                    <p>
                      Desafiante:{" "}
                      <strong>
                        {desafiante?.nome || desafiante?.email || d.desafiante_uid}
                      </strong>
                    </p>
                    <p>
                      Líder:{" "}
                      <strong>
                        {lider?.nome || lider?.email || d.lider_uid}
                      </strong>
                    </p>
                  </div>

                  <div className="text-sm bg-white border rounded p-2">
                    {resumo}
                  </div>

                  <div className="flex gap-2">
                    <a
                      href={`/ginasios/${d.ginasio_id}/disputa`}
                      className="text-sm text-blue-600 underline"
                    >
                      Abrir página da disputa
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* PENDENTES > 7 DIAS */}
      <section className="bg-white rounded shadow p-4">
        <h2 className="text-lg font-semibold mb-3">
          Desafios pendentes há mais de 7 dias
        </h2>
        {pendentesAtrasados.length === 0 ? (
          <p className="text-sm text-gray-500">
            Nenhum desafio pendente acima de 7 dias.
          </p>
        ) : (
          <ul className="space-y-3">
            {pendentesAtrasados.map((d) => {
              const gym = gyms[d.ginasio_id];
              const desafiante = users[d.desafiante_uid];
              const lider = users[d.lider_uid];
              return (
                <li
                  key={d.id}
                  className="border rounded p-3 flex flex-col gap-2 bg-gray-50"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold">
                        {gym?.nome || d.ginasio_id}{" "}
                        {gym?.liga ? (
                          <span className="text-xs text-gray-500">({gym.liga})</span>
                        ) : null}
                      </p>
                      <p className="text-xs text-gray-500">
                        Desafio: <span className="font-mono">{d.id}</span>
                      </p>
                    </div>
                    <p className="text-xs text-gray-500">
                      Criado {tempoRelativo(d.criadoEm)}
                    </p>
                  </div>

                  <div className="text-sm">
                    <p>
                      Desafiante:{" "}
                      <strong>
                        {desafiante?.nome || desafiante?.email || d.desafiante_uid}
                      </strong>
                    </p>
                    <p>
                      Líder:{" "}
                      <strong>
                        {lider?.nome || lider?.email || d.lider_uid}
                      </strong>
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <a
                      href={`/ginasios/${d.ginasio_id}/disputa`}
                      className="text-sm text-blue-600 underline"
                    >
                      Abrir página da disputa
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Texto curto explicando o conflito */
function interpreta(
  resultadoDesafiante?: "lider" | "desafiante",
  resultadoLider?: "lider" | "desafiante"
) {
  const r2txt = (r?: "lider" | "desafiante") =>
    r === "lider" ? "que o LÍDER venceu" : r === "desafiante" ? "que o DESAFIANTE venceu" : "sem declaração";

  if (resultadoDesafiante && resultadoLider) {
    if (resultadoDesafiante !== resultadoLider) {
      return `Conflito: o desafiante declarou ${r2txt(
        resultadoDesafiante
      )}, enquanto o líder declarou ${r2txt(resultadoLider)}.`;
    }
    return `Ambos declararam ${r2txt(resultadoDesafiante)} — verificar motivo de ainda constar como "conflito".`;
  }

  if (resultadoDesafiante && !resultadoLider) {
    return `Apenas o desafiante declarou ${r2txt(resultadoDesafiante)}; o líder ainda não declarou resultado.`;
  }
  if (!resultadoDesafiante && resultadoLider) {
    return `Apenas o líder declarou ${r2txt(resultadoLider)}; o desafiante ainda não declarou resultado.`;
  }
  return "Nenhum dos dois declarou resultado.";
}

/** "há 3d", "há 2h"… */
function tempoRelativo(ts?: number) {
  if (!ts) return "há tempo indeterminado";
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `há ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}
