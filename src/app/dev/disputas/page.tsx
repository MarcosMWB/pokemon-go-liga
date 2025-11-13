// src/app/dev/desafios/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  onSnapshot,
  getDocs,
  getDoc,
  doc,
  orderBy,
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

type GymInfo = { nome: string; liga?: string };
type UserInfo = { display: string };

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
  if (!ms) return "indeterminado";
  const diff = Date.now() - ms;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export default function DevDesafiosPage() {
  const router = useRouter();

  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [desafios, setDesafios] = useState<Desafio[]>([]);
  const [gMap, setGMap] = useState<Record<string, GymInfo>>({});
  const [uMap, setUMap] = useState<Record<string, UserInfo>>({});
  const [ligaFiltro, setLigaFiltro] = useState<string>("");
  const [statusFiltro, setStatusFiltro] = useState<"" | "pendente" | "conflito" | "concluido">("");
  const [textoBusca, setTextoBusca] = useState<string>("");
  const [ligasDisponiveis, setLigasDisponiveis] = useState<string[]>([]);

  // Auth + superuser
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      const qSup = query(collection(db, "superusers"), where("uid", "==", user.uid));
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

  // Snapshot de desafios (todos os status; filtramos no cliente)
  useEffect(() => {
    if (isAdmin !== true) return;

    const qDesafios = query(collection(db, "desafios_ginasio"), orderBy("criadoEm", "desc"));
    const unsub = onSnapshot(qDesafios, (snap) => {
      const list: Desafio[] = snap.docs.map((d) => {
        const x = d.data() as any;
        return {
          id: d.id,
          ginasio_id: x.ginasio_id,
          lider_uid: x.lider_uid,
          desafiante_uid: x.desafiante_uid,
          status: x.status,
          criadoEmMs: toMillis(x.criadoEm),
          resultado_lider: x.resultado_lider,
          resultado_desafiante: x.resultado_desafiante,
        };
      });
      setDesafios(list);
    });

    return () => unsub();
  }, [isAdmin]);

  // GINÁSIOS (nome + liga) — evita loop infinito
  useEffect(() => {
    if (isAdmin !== true) return;

    const ids = Array.from(new Set(desafios.map((d) => d.ginasio_id))).filter(Boolean);
    let cancelled = false;

    (async () => {
      const updates: Record<string, GymInfo> = {};
      const ligasSet = new Set<string>(ligasDisponiveis);

      for (const gid of ids) {
        if (!gMap[gid]) {
          const g = await getDoc(doc(db, "ginasios", gid));
          if (g.exists()) {
            const gd = g.data() as any;
            updates[gid] = { nome: gd.nome || gid, liga: gd.liga || "" };
            if (gd.liga) ligasSet.add(gd.liga);
          } else {
            updates[gid] = { nome: gid };
          }
        } else if (gMap[gid].liga) {
          ligasSet.add(gMap[gid].liga!);
        }
      }

      if (cancelled) return;

      if (Object.keys(updates).length) {
        setGMap((prev) => ({ ...prev, ...updates }));
      }

      const arr = Array.from(ligasSet).sort();
      setLigasDisponiveis((prev) => {
        const prevKey = prev.join("|");
        const newKey = arr.join("|");
        return prevKey === newKey ? prev : arr;
      });
    })();

    return () => {
      cancelled = true;
    };
    // deps só no que realmente dispara novas buscas
  }, [desafios, isAdmin]); // <- sem gMap/ligasDisponiveis

  // USUÁRIOS (nomes) — evita loop infinito
  useEffect(() => {
    if (isAdmin !== true) return;

    const uids = new Set<string>();
    desafios.forEach((d) => {
      if (d.lider_uid) uids.add(d.lider_uid);
      if (d.desafiante_uid) uids.add(d.desafiante_uid);
    });

    let cancelled = false;

    (async () => {
      const updates: Record<string, UserInfo> = {};

      for (const uid of uids) {
        if (!uMap[uid]) {
          const u = await getDoc(doc(db, "usuarios", uid));
          if (u.exists()) {
            const ud = u.data() as any;
            updates[uid] = { display: ud.nome || ud.email || uid };
          } else {
            updates[uid] = { display: uid };
          }
        }
      }

      if (cancelled) return;
      if (Object.keys(updates).length) {
        setUMap((prev) => ({ ...prev, ...updates }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [desafios, isAdmin]); // <- sem uMap

  const filtrados = useMemo(() => {
    return desafios.filter((d) => {
      if (statusFiltro && d.status !== statusFiltro) return false;

      const liga = gMap[d.ginasio_id]?.liga || "";
      if (ligaFiltro && liga !== ligaFiltro) return false;

      if (textoBusca.trim()) {
        const t = textoBusca.trim().toLowerCase();
        const gymName = (gMap[d.ginasio_id]?.nome || d.ginasio_id).toLowerCase();
        const desafiante = (uMap[d.desafiante_uid]?.display || d.desafiante_uid).toLowerCase();
        const lider = (uMap[d.lider_uid]?.display || d.lider_uid).toLowerCase();
        if (!gymName.includes(t) && !desafiante.includes(t) && !lider.includes(t)) {
          return false;
        }
      }

      return true;
    });
  }, [desafios, statusFiltro, ligaFiltro, textoBusca, gMap, uMap]);

  if (isAdmin === null) return <p className="p-6">Carregando…</p>;
  if (isAdmin === false) return null;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dev / Desafios (Jogador vs. Líder)</h1>
          <p className="text-sm text-gray-500">Acompanhe todos os desafios em tempo real.</p>
        </div>
        <button onClick={() => router.push("/dev")} className="text-sm text-blue-600 underline">
          Voltar ao painel
        </button>
      </div>

      <div className="bg-white p-4 rounded shadow grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Status</label>
          <select
            value={statusFiltro}
            onChange={(e) => setStatusFiltro(e.target.value as any)}
            className="border rounded px-2 py-1 text-sm w-full"
          >
            <option value="">Todos</option>
            <option value="pendente">Pendentes</option>
            <option value="conflito">Conflitos</option>
            <option value="concluido">Concluídos</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Liga</label>
          <select
            value={ligaFiltro}
            onChange={(e) => setLigaFiltro(e.target.value)}
            className="border rounded px-2 py-1 text-sm w-full"
          >
            <option value="">Todas</option>
            {ligasDisponiveis.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-2">
          <input
            value={textoBusca}
            onChange={(e) => setTextoBusca(e.target.value)}
            placeholder="Buscar por ginásio, desafiante ou líder"
            className="border rounded px-2 py-1 text-sm w-full"
          />
        </div>
      </div>

      {filtrados.length === 0 ? (
        <p className="text-sm text-gray-500">Nenhum desafio encontrado.</p>
      ) : (
        <div className="space-y-3">
          {filtrados.map((d) => {
            const gym = gMap[d.ginasio_id];
            const liga = gym?.liga || "Sem liga";
            const gymName = gym?.nome || d.ginasio_id;
            const desafiante = uMap[d.desafiante_uid]?.display || d.desafiante_uid;
            const lider = uMap[d.lider_uid]?.display || d.lider_uid;

            const t = d.criadoEmMs ? tempoRelativo(d.criadoEmMs) : "indeterminado";
            const dias = d.criadoEmMs ? Math.floor((Date.now() - d.criadoEmMs) / 86400000) : null;
            const velho = dias !== null && dias >= 7;

            return (
              <div
                key={d.id}
                className={`bg-white rounded shadow p-4 flex items-center justify-between ${
                  d.status === "conflito" ? "border border-red-300" : ""
                }`}
              >
                <div className="space-y-1">
                  <p className="font-semibold">
                    {desafiante} vs {lider}
                  </p>
                  <p className="text-sm text-gray-700">
                    Ginásio: <span className="font-medium">{gymName}</span>{" "}
                    <span className="text-gray-500">· Liga: {liga}</span>
                  </p>
                  <p className="text-xs text-gray-600">
                    Status:{" "}
                    <span
                      className={`px-2 py-0.5 rounded text-white ${
                        d.status === "pendente"
                          ? "bg-blue-600"
                          : d.status === "conflito"
                          ? "bg-red-600"
                          : "bg-green-600"
                      }`}
                    >
                      {d.status}
                    </span>{" "}
                    · Criado há {t} {velho && <span className="text-red-600">(7+ dias)</span>}
                  </p>

                  {(d.resultado_desafiante || d.resultado_lider) && (
                    <p className="text-xs text-gray-600">
                      Confirmações — desafiante: {d.resultado_desafiante || "—"} · líder:{" "}
                      {d.resultado_lider || "—"}
                    </p>
                  )}

                  <p className="text-[10px] text-gray-400">ID desafio: {d.id}</p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => router.push(`/ginasios/${d.ginasio_id}`)}
                    className="px-3 py-1 rounded bg-gray-200 text-gray-800 text-sm"
                  >
                    Ver ginásio
                  </button>
                  <button
                    onClick={() => router.push(`/perfil/${d.desafiante_uid}`)}
                    className="px-3 py-1 rounded bg-purple-600 text-white text-sm"
                  >
                    Desafiante
                  </button>
                  <button
                    onClick={() => router.push(`/perfil/${d.lider_uid}`)}
                    className="px-3 py-1 rounded bg-orange-600 text-white text-sm"
                  >
                    Líder
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
