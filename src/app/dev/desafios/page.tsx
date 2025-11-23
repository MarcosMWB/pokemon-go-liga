// src/app/dev/desafios/page.tsx
"use client";

import type { User } from "firebase/auth";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  Unsubscribe,
} from "firebase/firestore";

type Desafio = {
  id: string;
  pairKey: string;
  disputa_id: string;
  ginasio_id: string;
  liga?: string;
  status: "pendente" | "conflito" | "concluido";
  lider_uid: string;
  desafiante_uid: string;
  createdAt?: number | any; // pode vir TS/Firestore Timestamp/number
};

type Msg = { id: string; from: string; text: string; createdAt: any };

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

function timeAgo(ms?: number | null) {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export default function DevDesafiosPage() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  const [statusFilter, setStatusFilter] = useState<"todos" | "pendente" | "conflito" | "concluido">("pendente");
  const [ligaFilter, setLigaFilter] = useState<string>("");
  const [search, setSearch] = useState("");

  const [desafios, setDesafios] = useState<Desafio[]>([]);
  const [ligasDisponiveis, setLigasDisponiveis] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // caches de nomes
  const [userNameByUid, setUserNameByUid] = useState<Record<string, string>>({});
  const [gymNameById, setGymNameById] = useState<Record<string, string>>({});

  // modal de chat
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDesafio, setChatDesafio] = useState<Desafio | null>(null);
  const [chatMsgs, setChatMsgs] = useState<Msg[]>([]);
  const chatUnsubRef = useRef<Unsubscribe | null>(null);

  // — Auth + superuser
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (current: User | null) => {
      if (!current) {
        setIsAdmin(false);
        router.replace("/login");
        return;
      }
      try {
        // aceita dois formatos de "superusers": doc por uid OU campo uid
        const asDoc = await getDoc(doc(db, "superusers", current.uid));
        if (asDoc.exists()) {
          setIsAdmin(true);
          return;
        }
      } catch { }
      try {
        const q = query(collection(db, "superusers"), where("uid", "==", current.uid));
        const unsubOnce = onSnapshot(q, (snap) => {
          setIsAdmin(!snap.empty);
        });
        return () => unsubOnce();
      } catch {
        setIsAdmin(false);
        router.replace("/");
      }
    });
    return () => unsub();
  }, [router]);

  // — Carregar desafios conforme filtros
  useEffect(() => {
    if (isAdmin !== true) return;
    setLoading(true);

    const col = collection(db, "desafios_ginasio");
    const conds = [];
    if (statusFilter !== "todos") {
      conds.push(where("status", "==", statusFilter));
    }
    if (ligaFilter) {
      conds.push(where("liga", "==", ligaFilter));
    }

    // sempre ordenar por createdAt desc (se não houver, caiu pra "agora")
    let qRef = query(col, orderBy("createdAt", "desc"));
    // Firestore exige montar a query já com os wheres
    if (conds.length === 1) qRef = query(col, conds[0], orderBy("createdAt", "desc"));
    if (conds.length === 2) qRef = query(col, conds[0], conds[1], orderBy("createdAt", "desc"));

    const unsub = onSnapshot(
      qRef,
      (snap) => {
        const list: Desafio[] = snap.docs.map((d) => {
          const x = d.data() as any;
          return {
            id: d.id,
            pairKey: x.pairKey,
            disputa_id: x.disputa_id,
            ginasio_id: x.ginasio_id,
            liga: x.liga || "",
            status: x.status || "pendente",
            lider_uid: x.lider_uid,
            desafiante_uid: x.desafiante_uid,
            createdAt: toMillis(x.createdAt) ?? Date.now(),
          };
        });

        // filtro de busca client-side (por UID, pairKey, ginásio)
        const s = search.trim().toLowerCase();
        const filtered = s
          ? list.filter((d) => {
            const parts = [
              d.pairKey,
              d.ginasio_id,
              d.disputa_id,
              d.lider_uid,
              d.desafiante_uid,
              userNameByUid[d.lider_uid],
              userNameByUid[d.desafiante_uid],
              gymNameById[d.ginasio_id],
            ]
              .filter(Boolean)
              .map((v) => String(v).toLowerCase());
            return parts.some((p) => p.includes(s));
          })
          : list;

        setDesafios(filtered);

        // depois (type guard garante string[])
        const ligs = Array
          .from(new Set(list.map(d => d.liga)))
          .filter((x): x is string => typeof x === "string" && x.length > 0);

        setLigasDisponiveis(ligs.sort());


        // dispara preenchimento de caches
        const uids = new Set<string>();
        const gymIds = new Set<string>();
        list.forEach((d) => {
          if (!userNameByUid[d.lider_uid]) uids.add(d.lider_uid);
          if (!userNameByUid[d.desafiante_uid]) uids.add(d.desafiante_uid);
          if (!gymNameById[d.ginasio_id]) gymIds.add(d.ginasio_id);
        });
        if (uids.size) fetchUsers(Array.from(uids));
        if (gymIds.size) fetchGyms(Array.from(gymIds));

        setLoading(false);
      },
      () => setLoading(false)
    );

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, statusFilter, ligaFilter, search]);

  async function fetchUsers(uids: string[]) {
    const entries: Record<string, string> = {};
    await Promise.all(
      uids.map(async (uid) => {
        try {
          const s = await getDoc(doc(db, "usuarios", uid));
          if (s.exists()) {
            const d = s.data() as any;
            entries[uid] = d.nome || d.email || uid;
          } else {
            entries[uid] = uid;
          }
        } catch {
          entries[uid] = uid;
        }
      })
    );
    setUserNameByUid((prev) => ({ ...prev, ...entries }));
  }

  async function fetchGyms(ids: string[]) {
    const entries: Record<string, string> = {};
    await Promise.all(
      ids.map(async (id) => {
        try {
          const s = await getDoc(doc(db, "ginasios", id));
          if (s.exists()) {
            const d = s.data() as any;
            entries[id] = d.nome || id;
          } else {
            entries[id] = id;
          }
        } catch {
          entries[id] = id;
        }
      })
    );
    setGymNameById((prev) => ({ ...prev, ...entries }));
  }

  // contadores por status
  const counts = useMemo(() => {
    const c = { pendente: 0, conflito: 0, concluido: 0 };
    desafios.forEach((d) => {
      if (d.status === "pendente") c.pendente++;
      else if (d.status === "conflito") c.conflito++;
      else if (d.status === "concluido") c.concluido++;
    });
    return c;
  }, [desafios]);

  async function setStatus(d: Desafio, st: Desafio["status"]) {
    await updateDoc(doc(db, "desafios_ginasio", d.id), {
      status: st,
      atualizadoEm: Date.now(),
      atualizadoPor: auth.currentUser?.uid || null,
    });
  }

  function openChat(d: Desafio) {
    setChatOpen(true);
    setChatDesafio(d);
    chatUnsubRef.current?.();
    chatUnsubRef.current = onSnapshot(
      query(collection(db, "desafios_ginasio", d.id, "mensagens"), orderBy("createdAt", "asc")),
      (snap) => {
        setChatMsgs(
          snap.docs.map((m) => {
            const x = m.data() as any;
            return { id: m.id, from: x.from, text: x.text, createdAt: toMillis(x.createdAt) };
          })
        );
      }
    );
  }

  function closeChat() {
    chatUnsubRef.current?.();
    chatUnsubRef.current = null;
    setChatOpen(false);
    setChatDesafio(null);
    setChatMsgs([]);
  }

  if (isAdmin === null) return <p className="p-6">Carregando…</p>;
  if (isAdmin === false) return null;

  return (
    <main className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Desafios (Jogador vs Líder)</h1>
          <p className="text-sm text-gray-500">
            Acompanhe solicitações entre jogadores e líderes por ginásio, veja o chat e atualize o status.
          </p>
        </div>
        <button onClick={() => router.push("/dev")} className="text-sm text-blue-600 underline">
          Voltar ao painel
        </button>
      </div>

      <section className="bg-white rounded shadow p-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-gray-500">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="todos">Todos</option>
            <option value="pendente">Pendentes</option>
            <option value="conflito">Conflitos</option>
            <option value="concluido">Concluídos</option>
          </select>

          <label className="text-xs text-gray-500 ml-3">Liga</label>
          <select
            value={ligaFilter}
            onChange={(e) => setLigaFilter(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="">Todas</option>
            {ligasDisponiveis.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar (uid, nome, ginásio, pairKey)"
            className="ml-auto border rounded px-3 py-1.5 text-sm w-full sm:w-64"
          />
        </div>

        <div className="mt-3 flex gap-2 text-xs">
          <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-700">
            Pendentes: {counts.pendente}
          </span>
          <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-700">
            Conflitos: {counts.conflito}
          </span>
          <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">
            Concluídos: {counts.concluido}
          </span>
          {loading && <span className="ml-auto text-gray-500">Atualizando…</span>}
        </div>
      </section>

      <section className="bg-white rounded shadow p-4">
        {desafios.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum desafio encontrado.</p>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-3">Criado</th>
                  <th className="py-2 pr-3">Liga</th>
                  <th className="py-2 pr-3">Ginásio</th>
                  <th className="py-2 pr-3">Líder</th>
                  <th className="py-2 pr-3">Desafiante</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3 w-64">Ações</th>
                </tr>
              </thead>
              <tbody>
                {desafios.map((d) => {
                  const createdMs = toMillis(d.createdAt) ?? 0;
                  const gName = gymNameById[d.ginasio_id] || d.ginasio_id;
                  const liderName = userNameByUid[d.lider_uid] || d.lider_uid;
                  const desafName = userNameByUid[d.desafiante_uid] || d.desafiante_uid;

                  return (
                    <tr key={d.id} className="border-b align-top">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <div title={createdMs ? new Date(createdMs).toLocaleString() : ""}>
                          {timeAgo(createdMs)}
                        </div>
                        <div className="text-[10px] text-gray-500">{d.pairKey.slice(0, 16)}…</div>
                      </td>
                      <td className="py-2 pr-3">{d.liga || "—"}</td>
                      <td className="py-2 pr-3">
                        <div className="font-medium">{gName}</div>
                        <Link
                          href={`/ginasios/${d.ginasio_id}`}
                          className="text-[11px] text-blue-600 underline"
                        >
                          abrir ginásio
                        </Link>
                      </td>
                      <td className="py-2 pr-3">
                        <div className="font-medium">{liderName}</div>
                        <Link
                          href={`/perfil/${d.lider_uid}`}
                          className="text-[11px] text-blue-600 underline"
                        >
                          perfil
                        </Link>
                      </td>
                      <td className="py-2 pr-3">
                        <div className="font-medium">{desafName}</div>
                        <Link
                          href={`/perfil/${d.desafiante_uid}`}
                          className="text-[11px] text-blue-600 underline"
                        >
                          perfil
                        </Link>
                      </td>
                      <td className="py-2 pr-3">
                        {d.status === "pendente" && (
                          <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-700 text-xs">
                            Pendente
                          </span>
                        )}
                        {d.status === "conflito" && (
                          <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-700 text-xs">
                            Conflito
                          </span>
                        )}
                        {d.status === "concluido" && (
                          <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 text-xs">
                            Concluído
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => openChat(d)}
                            className="px-2 py-1 rounded bg-slate-800 text-white text-xs"
                          >
                            Ver chat
                          </button>

                          {d.status !== "concluido" && (
                            <button
                              onClick={() => setStatus(d, "concluido")}
                              className="px-2 py-1 rounded bg-emerald-600 text-white text-xs"
                            >
                              Marcar como concluído
                            </button>
                          )}

                          {d.status !== "conflito" && (
                            <button
                              onClick={() => setStatus(d, "conflito")}
                              className="px-2 py-1 rounded bg-amber-600 text-white text-xs"
                            >
                              Marcar conflito
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Modal de chat (somente leitura) */}
      {chatOpen && chatDesafio && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={closeChat} />
          <div className="relative bg-white w-full max-w-2xl max-h-[90vh] rounded-xl shadow-xl p-4 md:p-5 flex flex-col">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Chat do Desafio</h3>
                <p className="text-xs text-slate-500">
                  {userNameByUid[chatDesafio.lider_uid] || chatDesafio.lider_uid} ×{" "}
                  {userNameByUid[chatDesafio.desafiante_uid] || chatDesafio.desafiante_uid} —{" "}
                  ginásio {gymNameById[chatDesafio.ginasio_id] || chatDesafio.ginasio_id}
                </p>
              </div>
              <button className="text-slate-500 hover:text-slate-800 text-sm" onClick={closeChat}>
                Fechar
              </button>
            </div>

            <div className="mt-3 border rounded-lg p-2 overflow-auto bg-slate-50" style={{ maxHeight: 420 }}>
              {chatMsgs.length === 0 ? (
                <p className="text-xs text-slate-500">Nenhuma mensagem.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {chatMsgs.map((m) => {
                    const who =
                      m.from === chatDesafio.lider_uid
                        ? userNameByUid[chatDesafio.lider_uid] || "Líder"
                        : m.from === chatDesafio.desafiante_uid
                          ? userNameByUid[chatDesafio.desafiante_uid] || "Desafiante"
                          : m.from;
                    return (
                      <div key={m.id} className="bg-white border rounded p-2">
                        <div className="text-[11px] text-slate-500 flex items-center justify-between">
                          <span>{who}</span>
                          <span>{m.createdAt ? new Date(m.createdAt).toLocaleString() : ""}</span>
                        </div>
                        <div className="text-sm mt-1 whitespace-pre-wrap break-words">{m.text}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <p className="mt-2 text-[11px] text-slate-500">
              Somente leitura pelo painel. A conversa é entre os participantes do desafio.
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
