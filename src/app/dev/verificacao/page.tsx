// app/dev/verificacao/page.tsx
"use client";

import type { User } from "firebase/auth";
import { useCallback, useEffect, useMemo, useState } from "react";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  Timestamp,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

type RowPriv = {
  id: string;
  nome?: string;
  email?: string;
  friend_code?: string;
  autenticadoPorAdm?: boolean;
  createdAtMs?: number | null;
};

function since(ms?: number | null): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  if (diff < 0) return "agora";
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) {
    const mm = m % 60;
    return mm ? `${h} h ${mm} min` : `${h} h`;
  }
  const d = Math.floor(h / 24);
  if (d < 30) {
    const hh = h % 24;
    return hh ? `${d} d ${hh} h` : `${d} d`;
  }
  const mo = Math.floor(d / 30);
  return mo ? `${mo} m` : `${d} d`;
}

export default function VerificacaoUsuariosPage() {
  const [uid, setUid] = useState<string | null>(null);
  const [isSuper, setIsSuper] = useState(false);

  const [privRows, setPrivRows] = useState<RowPriv[]>([]);
  const [usuariosIds, setUsuariosIds] = useState<Set<string>>(new Set());

  const [editing, setEditing] = useState<Record<string, string>>({});
  const [busca, setBusca] = useState("");

  const functions = getFunctions(undefined, "southamerica-east1");
  const fnDelete = httpsCallable(functions, "adminDeleteUser");

  // Auth + flag de super
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (u: User | null) => {
      setUid(u?.uid ?? null);
      if (u?.uid) {
        const s = await getDoc(doc(db, "superusers", u.uid));
        setIsSuper(s.exists());
      } else {
        setIsSuper(false);
      }
    });
    return () => unsub();
  }, []);

  // Snapshots: usuarios_private e usuarios
  useEffect(() => {
    if (!isSuper) return;

    const unsubPriv = onSnapshot(collection(db, "usuarios_private"), (snap) => {
      const list: RowPriv[] = snap.docs.map((d) => {
        const x = d.data() as any;
        // tenta pegar createdAt seja como Timestamp, seja como número auxiliar
        let createdAtMs: number | null = null;
        const ca = x.createdAt;
        if (ca instanceof Timestamp) createdAtMs = ca.toMillis();
        else if (typeof x.createdAtMs === "number") createdAtMs = x.createdAtMs;
        return {
          id: d.id,
          nome: x.nome || "",
          email: x.email || "",
          friend_code: x.friend_code || "",
          autenticadoPorAdm: !!(x.autenticadoPorAdm || x.autenticado_por_adm),
          createdAtMs,
        };
      });
      setPrivRows(list);
    });

    const unsubUsuarios = onSnapshot(collection(db, "usuarios"), (snap) => {
      setUsuariosIds(new Set(snap.docs.map((d) => d.id)));
    });

    return () => {
      unsubPriv();
      unsubUsuarios();
    };
  }, [isSuper]);

  // Filtro de busca
  const filtrarBusca = useCallback(
    (r: RowPriv) => {
      const q = busca.trim().toLowerCase();
      if (!q) return true;
      return (
        (r.nome || "").toLowerCase().includes(q) ||
        (r.email || "").toLowerCase().includes(q) ||
        (r.friend_code || "").toLowerCase().includes(q)
      );
    },
    [busca]
  );

  // Listas derivadas
  const naoAutenticados = useMemo(
    () => privRows.filter((r) => !usuariosIds.has(r.id)).filter(filtrarBusca),
    [privRows, usuariosIds, filtrarBusca]
  );

  const autenticados = useMemo(
    () => privRows.filter((r) => usuariosIds.has(r.id)).filter(filtrarBusca),
    [privRows, usuariosIds, filtrarBusca]
  );

  if (!uid) return <div className="p-6">Faça login.</div>;
  if (!isSuper) return <div className="p-6">Acesso negado.</div>;

  // Ações
  async function salvarNome(r: RowPriv) {
    const novoNome = (editing[r.id] ?? r.nome ?? "").trim();
    if (!novoNome) return;

    await updateDoc(doc(db, "usuarios_private", r.id), {
      nome: novoNome,
      nomeAtualizadoPor: uid,
      nomeAtualizadoEm: serverTimestamp(),
    });

    // Mantém consistência se já existir o público
    if (usuariosIds.has(r.id)) {
      try {
        await updateDoc(doc(db, "usuarios", r.id), {
          nome: novoNome,
          nomeAtualizadoPor: uid,
          nomeAtualizadoEm: serverTimestamp(),
        });
      } catch {
        // se não existir por algum motivo, ignoramos
      }
    }
  }

  async function excluirUsuario(r: RowPriv, motivo?: "fc_falso" | "nao_verificado") {
    const confirmMsg =
      motivo === "nao_verificado"
        ? `Confirma excluir o usuário NÃO VERIFICADO?\n\n${r.email || "(sem e-mail)"}`
        : `Digite o e-mail para confirmar a exclusão (motivo: FC falso):\n${r.email || "(sem e-mail)"}`;

    let ok = true;
    if (motivo === "nao_verificado") {
      ok = window.confirm(confirmMsg);
      if (!ok) return;
    } else {
      const conf = window.prompt(confirmMsg);
      if ((r.email || "").toLowerCase() !== (conf || "").trim().toLowerCase()) {
        alert("Confirmação cancelada.");
        return;
      }
    }

    try {
      await fnDelete({ targetUid: r.id }); // CF deve apagar Auth + usuarios + usuarios_private
      alert("Usuário excluído.");
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Falha ao excluir.");
    }
  }

  // Linhas
  function LinhaAutenticado(r: RowPriv) {
    return (
      <li
        key={r.id}
        className="bg-white border rounded p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium break-all">{r.email || "(sem e-mail)"}</p>
          <p className="text-xs text-gray-600 break-all">UID: {r.id}</p>
          <p className="text-xs text-gray-600 break-all">Friend code: {r.friend_code || "—"}</p>
          <div className="mt-2 flex items-center gap-2">
            <label className="text-xs text-gray-500">Nome</label>
            <input
              className="border rounded px-2 py-1 text-sm"
              value={editing[r.id] ?? r.nome ?? ""}
              onChange={(e) => setEditing((s) => ({ ...s, [r.id]: e.target.value }))}
              placeholder="Nome do jogador"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => salvarNome(r)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-3 py-2 rounded"
          >
            Salvar
          </button>
          <button
            onClick={() => excluirUsuario(r, "fc_falso")}
            className="bg-red-600 hover:bg-red-700 text-white text-sm px-3 py-2 rounded"
          >
            Excluir (FC falso)
          </button>
        </div>
      </li>
    );
  }

  function LinhaNaoAutenticado(r: RowPriv) {
    return (
      <li
        key={r.id}
        className="bg-white border rounded p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium break-all">{r.email || "(sem e-mail)"}</p>
          <p className="text-xs text-gray-600 break-all">UID: {r.id}</p>
          <p className="text-xs text-gray-600 break-all">Friend code: {r.friend_code || "—"}</p>
          <p className="text-xs text-amber-700 mt-1">
            Perfil não autenticado {r.createdAtMs ? `– criado há ${since(r.createdAtMs)}` : ""}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <label className="text-xs text-gray-500">Nome</label>
            <input
              className="border rounded px-2 py-1 text-sm"
              value={editing[r.id] ?? r.nome ?? ""}
              onChange={(e) => setEditing((s) => ({ ...s, [r.id]: e.target.value }))}
              placeholder="Nome do jogador"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => salvarNome(r)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-3 py-2 rounded"
          >
            Salvar
          </button>
          <button
            onClick={() => excluirUsuario(r, "nao_verificado")}
            className="bg-red-600 hover:bg-red-700 text-white text-sm px-3 py-2 rounded"
          >
            Excluir não verificado
          </button>
        </div>
      </li>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">Admin · Verificação de usuários</h1>

      <div className="flex items-center gap-2">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="border rounded px-3 py-2 text-sm w-full sm:w-80"
          placeholder="Buscar por nome, e-mail ou friend code"
        />
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Não autenticados ({naoAutenticados.length})</h2>
        {naoAutenticados.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum.</p>
        ) : (
          <ul className="space-y-2">{naoAutenticados.map(LinhaNaoAutenticado)}</ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Autenticados ({autenticados.length})</h2>
        {autenticados.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum autenticado.</p>
        ) : (
          <ul className="space-y-2">{autenticados.map(LinhaAutenticado)}</ul>
        )}
      </section>
    </div>
  );
}
