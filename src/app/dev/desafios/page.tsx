// src/app/dev/desafios/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { auth, db } from "@/lib/firebase";
import type { User } from "firebase/auth";
import {
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
  getDocs,
  doc,
  getDoc,
} from "firebase/firestore";

type Desafio = {
  id: string;
  pairKey?: string;
  disputa_id?: string;
  ginasio_id?: string;
  liga?: string;
  status?: "pendente" | "conflito" | "concluido";
  lider_uid?: string;
  desafiante_uid?: string;
  createdAt?: number;
};

type Ginasio = { id: string; nome?: string; liga?: string };

function short(v?: string, n = 6) {
  return typeof v === "string" && v.length ? v.slice(0, n) : "—";
}
function asStr(v: unknown, fallback = "—") {
  return typeof v === "string" && v.length ? v : fallback;
}
function fmtDate(ts?: number) {
  if (!Number.isFinite(ts)) return "—";
  try {
    const d = new Date(ts!);
    return d.toLocaleString();
  } catch {
    return "—";
  }
}

export default function DevDesafiosPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [desafios, setDesafios] = useState<Desafio[]>([]);
  const [ligasDisponiveis, setLigasDisponiveis] = useState<string[]>([]);
  const [ligaSel, setLigaSel] = useState<string>("");
  const [statusSel, setStatusSel] = useState<"abertos" | "todos">("abertos");

  // auth + verificação de superuser
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (u: User | null) => {
      if (!u) {
        setIsAdmin(false);
        return;
      }
      // superusers/{uid} como doc direto
      const sup = await getDoc(doc(db, "superusers", u.uid));
      setIsAdmin(sup.exists());
    });
    return () => unsub();
  }, []);

  // stream de desafios
  useEffect(() => {
    if (isAdmin !== true) return;

    // Pegamos todos e filtramos no cliente para simplicidade
    const qBase = query(
      collection(db, "desafios_ginasio"),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(qBase, (snap) => {
      const list: Desafio[] = snap.docs.map((d) => {
        const x = d.data() as any;
        return {
          id: d.id,
          pairKey: x.pairKey,
          disputa_id: x.disputa_id,
          ginasio_id: x.ginasio_id,
          liga: x.liga,
          status: x.status,
          lider_uid: x.lider_uid,
          desafiante_uid: x.desafiante_uid,
          createdAt: typeof x.createdAt === "number" ? x.createdAt : undefined,
        };
      });

      setDesafios(list);

      // ligas para filtro (type guard p/ string[])
      const ligs = Array.from(new Set(list.map((d) => d.liga)))
        .filter((v): v is string => typeof v === "string" && v.length > 0)
        .sort();
      setLigasDisponiveis(ligs);
      if (!ligaSel && ligs[0]) setLigaSel(ligs[0]);
    });

    return () => unsub();
  }, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  // contadores
  const counts = useMemo(() => {
    const c = { pendente: 0, conflito: 0, concluido: 0 };
    for (const d of desafios) {
      const s = d.status ?? "pendente";
      if (s === "pendente") c.pendente++;
      else if (s === "conflito") c.conflito++;
      else if (s === "concluido") c.concluido++;
    }
    return c;
  }, [desafios]);

  // filtro aplicado
  const filtered = useMemo(() => {
    return desafios.filter((d) => {
      if (statusSel === "abertos" && (d.status === "concluido")) return false;
      if (ligaSel && d.liga && d.liga !== ligaSel) return false;
      if (ligaSel && !d.liga) return false; // quando filtro por liga, exige liga definida
      return true;
    });
  }, [desafios, statusSel, ligaSel]);

  // carrega nomes de ginásios sob demanda (opcional). Exemplo simples cacheado.
  const [gNames, setGNames] = useState<Record<string, string>>({});
  useEffect(() => {
    (async () => {
      const toFetch = new Set<string>();
      for (const d of filtered) {
        const gid = d.ginasio_id;
        if (gid && !gNames[gid]) toFetch.add(gid);
      }
      if (toFetch.size === 0) return;
      const results: Record<string, string> = {};
      await Promise.all(
        Array.from(toFetch).map(async (gid) => {
          try {
            const s = await getDoc(doc(db, "ginasios", gid));
            if (s.exists()) {
              const data = s.data() as any;
              results[gid] = asStr(data?.nome, gid);
            } else {
              results[gid] = gid;
            }
          } catch {
            results[gid] = gid;
          }
        })
      );
      setGNames((prev) => ({ ...prev, ...results }));
    })();
  }, [filtered, gNames]);

  if (isAdmin === null) return <p className="p-6">Carregando…</p>;
  if (isAdmin === false) return <p className="p-6">Sem acesso.</p>;

  return (
    <main className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Desafios (Jogador × Líder)</h1>
          <p className="text-sm text-gray-500">
            Canal oficial para marcar batalhas e registrar resultados.
          </p>
        </div>
        <Link href="/dev" className="text-sm text-blue-600 underline">
          Voltar ao painel
        </Link>
      </div>

      {/* Filtros e contadores */}
      <div className="bg-white rounded shadow p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Status</label>
          <select
            value={statusSel}
            onChange={(e) => setStatusSel(e.target.value as any)}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="abertos">Abertos (pendente/conflito)</option>
            <option value="todos">Todos</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Liga</label>
          <select
            value={ligaSel}
            onChange={(e) => setLigaSel(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="">Todas</option>
            {ligasDisponiveis.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>

        <div className="ml-auto flex items-center gap-2 text-xs">
          <span className="px-2 py-1 rounded bg-blue-100 text-blue-800">
            Pendentes: <b>{counts.pendente}</b>
          </span>
          <span className="px-2 py-1 rounded bg-amber-100 text-amber-800">
            Conflitos: <b>{counts.conflito}</b>
          </span>
          <span className="px-2 py-1 rounded bg-emerald-100 text-emerald-800">
            Concluídos: <b>{counts.concluido}</b>
          </span>
        </div>
      </div>

      {/* Lista */}
      <div className="bg-white rounded shadow p-4">
        {filtered.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum desafio encontrado.</p>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-3">Liga</th>
                  <th className="py-2 pr-3">Ginásio</th>
                  <th className="py-2 pr-3">Líder</th>
                  <th className="py-2 pr-3">Desafiante</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Criado em</th>
                  <th className="py-2 pr-3 w-28">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => {
                  const liga = asStr(d.liga);
                  const gName = d.ginasio_id ? (gNames[d.ginasio_id] ?? d.ginasio_id) : "—";
                  const status = asStr(d.status ?? "pendente");
                  const created = fmtDate(d.createdAt);

                  return (
                    <tr key={d.id} className="border-b">
                      <td className="py-2 pr-3">{liga}</td>
                      <td className="py-2 pr-3">{gName}</td>
                      <td className="py-2 pr-3">
                        <span title={d.lider_uid ?? ""}>{short(d.lider_uid, 8)}</span>
                      </td>
                      <td className="py-2 pr-3">
                        <span title={d.desafiante_uid ?? ""}>{short(d.desafiante_uid, 8)}</span>
                      </td>
                      <td className="py-2 pr-3 capitalize">{status}</td>
                      <td className="py-2 pr-3">{created}</td>
                      <td className="py-2 pr-3">
                        <Link
                          href={`/ginasios/${d.ginasio_id ?? ""}`}
                          className="text-blue-600 underline disabled:text-gray-400"
                          aria-disabled={!d.ginasio_id}
                          onClick={(e) => {
                            if (!d.ginasio_id) e.preventDefault();
                          }}
                        >
                          Abrir
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
