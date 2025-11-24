// app/dev/verificacao/page.tsx
"use client";

import type { User } from "firebase/auth";
import { useCallback, useEffect, useMemo, useState } from "react";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  doc,
  onSnapshot,
  updateDoc,
  serverTimestamp,
  getDoc,
} from "firebase/firestore";
import type { Unsubscribe } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

type Row = {
  id: string;
  nome?: string;
  email?: string;
  friend_code?: string;
  verificado?: boolean;
  autenticadoPorAdm?: boolean;
};

export default function VerificacaoUsuariosPage() {
  const [uid, setUid] = useState<string | null>(null);
  const [isSuper, setIsSuper] = useState<boolean>(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [busca, setBusca] = useState("");
  const functions = getFunctions(undefined, "southamerica-east1");
  const fnDelete = httpsCallable(functions, "adminDeleteUser");

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

  useEffect(() => {
    if (!isSuper) return;

    const qUsers = collection(db, "usuarios");
    const unsub: Unsubscribe = onSnapshot(qUsers, (snap) => {
      const list: Row[] = snap.docs.map((d) => {
        const x = d.data() as any;
        return {
          id: d.id,
          nome: x.nome || "",
          email: x.email || "",
          friend_code: x.friend_code || "",
          verificado: !!x.verificado,
          autenticadoPorAdm: !!(x.autenticadoPorAdm || x.autenticado_por_adm),
        };
      });
      setRows(list);
    });
    return () => unsub();
  }, [isSuper]);

  // ✅ memoiza e usa nas deps dos useMemo
  const filtrarBusca = useCallback(
    (r: Row) => {
      const b = busca.trim().toLowerCase();
      if (!b) return true;
      return (
        (r.nome || "").toLowerCase().includes(b) ||
        (r.email || "").toLowerCase().includes(b) ||
        (r.friend_code || "").toLowerCase().includes(b)
      );
    },
    [busca]
  );

  const pendentes = useMemo(
    () => rows.filter((r) => !!r.verificado && !r.autenticadoPorAdm).filter(filtrarBusca),
    [rows, filtrarBusca]
  );

  const autenticados = useMemo(
    () => rows.filter((r) => !!r.verificado && !!r.autenticadoPorAdm).filter(filtrarBusca),
    [rows, filtrarBusca]
  );

  const naoVerificados = useMemo(
    () => rows.filter((r) => !r.verificado).filter(filtrarBusca),
    [rows, filtrarBusca]
  );

  if (!uid) return <div className="p-6">Faça login.</div>;
  if (!isSuper) return <div className="p-6">Acesso negado.</div>;

  async function salvarEAUTENTICAR(r: Row) {
    const novoNome = (editing[r.id] ?? r.nome ?? "").trim();
    const ref = doc(db, "usuarios", r.id);
    await updateDoc(ref, {
      ...(novoNome ? { nome: novoNome } : {}),
      autenticadoPorAdm: true,
      autenticadoPorAdmPor: uid,
      autenticadoPorAdmEm: serverTimestamp(),
    });
  }

  async function excluirUsuario(r: Row) {
    const conf = window.prompt(
      `Digite o e-mail do usuário para confirmar a exclusão definitiva:\n${r.email || "(sem e-mail)"}`
    );
    if ((r.email || "").toLowerCase() !== (conf || "").trim().toLowerCase()) {
      alert("Confirmação cancelada.");
      return;
    }

    try {
      await fnDelete({ targetUid: r.id });
      alert("Usuário excluído.");
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Falha ao excluir.");
    }
  }

  function LinhaPendente(r: Row) {
    return (
      <li key={r.id} className="bg-white border rounded p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium break-all">{r.email || "(sem e-mail)"}</p>
          <p className="text-xs text-gray-600 break-all">UID: {r.id}</p>
          <p className="text-xs text-gray-600 break-all">Friend code: {r.friend_code || "—"}</p>
          <div className="mt-2 flex items-center gap-2">
            <label className="text-xs text-gray-500">Nome real</label>
            <input
              className="border rounded px-2 py-1 text-sm"
              value={editing[r.id] ?? r.nome ?? ""}
              onChange={(e) => setEditing((s) => ({ ...s, [r.id]: e.target.value }))}
              placeholder="Nome do usuário"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => salvarEAUTENTICAR(r)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-3 py-2 rounded"
          >
            Salvar e autenticar
          </button>
          <button
            onClick={() => excluirUsuario(r)}
            className="bg-red-600 hover:bg-red-700 text-white text-sm px-3 py-2 rounded"
          >
            Excluir
          </button>
        </div>
      </li>
    );
  }

  function LinhaAutenticado(r: Row) {
    return (
      <li key={r.id} className="bg-white border rounded p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium break-all">{r.nome || "(sem nome)"}</p>
          <p className="text-xs text-gray-600 break-all">{r.email || "—"}</p>
          <p className="text-xs text-gray-600 break-all">Friend code: {r.friend_code || "—"}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-[11px]">
            Autenticado
          </span>
          <button
            onClick={() => excluirUsuario(r)}
            className="bg-red-600 hover:bg-red-700 text-white text-sm px-3 py-2 rounded"
          >
            Excluir
          </button>
        </div>
      </li>
    );
  }

  function LinhaNaoVerificado(r: Row) {
    return (
      <li key={r.id} className="bg-white border rounded p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium break-all">{r.email || "(sem e-mail)"}</p>
          <p className="text-xs text-gray-600 break-all">UID: {r.id}</p>
          <p className="text-xs text-gray-600 break-all">Friend code: {r.friend_code || "—"}</p>
          <p className="text-xs text-amber-700 mt-1">Não confirmou o e-mail</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => excluirUsuario(r)}
            className="bg-red-600 hover:bg-red-700 text-white text-sm px-3 py-2 rounded"
          >
            Excluir
          </button>
        </div>
      </li>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">Verificação de usuários</h1>

      <div className="flex items-center gap-2">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="border rounded px-3 py-2 text-sm w-full sm:w-80"
          placeholder="Buscar por nome, e-mail ou friend code"
        />
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Pendentes de autenticação ({pendentes.length})</h2>
        {pendentes.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum pendente.</p>
        ) : (
          <ul className="space-y-2">{pendentes.map(LinhaPendente)}</ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Já autenticados ({autenticados.length})</h2>
        {autenticados.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum autenticado.</p>
        ) : (
          <ul className="space-y-2">{autenticados.map(LinhaAutenticado)}</ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Não verificados ({naoVerificados.length})</h2>
        {naoVerificados.length === 0 ? (
          <p className="text-sm text-gray-500">Todos confirmaram e-mail.</p>
        ) : (
          <ul className="space-y-2">{naoVerificados.map(LinhaNaoVerificado)}</ul>
        )}
      </section>
    </div>
  );
}
