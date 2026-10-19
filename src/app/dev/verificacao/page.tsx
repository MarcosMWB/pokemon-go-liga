// app/dev/verificacao/page.tsx
"use client";

import type { User } from "firebase/auth";
import { useCallback, useEffect, useMemo, useState } from "react";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  Timestamp,
  deleteField,
  writeBatch,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

type RowPriv = {
  id: string;
  nome?: string;
  email?: string;
  friend_code?: string;
  createdAtMs?: number | null;
};

type PubInfo = {
  verificado?: boolean;
  nome?: string;
};

function since(ms?: number | null): string {
  if (!ms) return "—";
  const diff = Date.now() - (ms || 0);
  if (diff < 0) return "agora";
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${m % 60 ? (m % 60) + " min" : ""}`.trim();
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} d ${h % 24 ? (h % 24) + " h" : ""}`.trim();
  const mo = Math.floor(d / 30);
  return mo ? `${mo} m` : `${d} d`;
}

export default function VerificacaoUsuariosPage() {
  const [uid, setUid] = useState<string | null>(null);
  const [isSuper, setIsSuper] = useState(false);

  const [privRows, setPrivRows] = useState<RowPriv[]>([]);
  const [pubMap, setPubMap] = useState<Record<string, PubInfo>>({});

  const [editing, setEditing] = useState<Record<string, string>>({});
  const [markVerified, setMarkVerified] = useState<Record<string, boolean>>({});
  const [busca, setBusca] = useState("");
  const [limpandoEmails, setLimpandoEmails] = useState(false);

  // feedback “copiado”
  const [copiedFC, setCopiedFC] = useState<string | null>(null);

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

    const unsubPriv = onSnapshot(collection(db, "usuarios_private"), (snap) => {
      const list: RowPriv[] = snap.docs.map((d) => {
        const x = d.data() as any;
        let createdAtMs: number | null = null;
        if (x.createdAt instanceof Timestamp) createdAtMs = x.createdAt.toMillis();
        else if (typeof x.createdAtMs === "number") createdAtMs = x.createdAtMs;
        return {
          id: d.id,
          nome: x.nome || "",
          email: x.email || "",
          friend_code: x.friend_code || "",
          createdAtMs,
        };
      });
      setPrivRows(list);
    });

    const unsubPub = onSnapshot(collection(db, "usuarios"), (snap) => {
      const map: Record<string, PubInfo> = {};
      snap.docs.forEach((d) => {
        const x = d.data() as any;
        map[d.id] = {
          verificado: !!x.verificado,
          nome: x.nome || "",
        };
      });
      setPubMap(map);
    });

    return () => {
      unsubPriv();
      unsubPub();
    };
  }, [isSuper]);

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

  const hasPub = useCallback((id: string) => pubMap[id] !== undefined, [pubMap]);
  const isVerified = useCallback((id: string) => !!pubMap[id]?.verificado, [pubMap]);

  const naoAutenticados = useMemo(
    () => privRows.filter((r) => !hasPub(r.id)).filter(filtrarBusca),
    [privRows, hasPub, filtrarBusca]
  );

  const autenticadosNaoVerificados = useMemo(
    () => privRows.filter((r) => hasPub(r.id) && !isVerified(r.id)).filter(filtrarBusca),
    [privRows, hasPub, isVerified, filtrarBusca]
  );

  if (!uid) return <div className="p-6">Faça login.</div>;
  if (!isSuper) return <div className="p-6">Acesso negado.</div>;

  async function salvarNomePrivEPub(r: RowPriv) {
    const novoNome = (editing[r.id] ?? r.nome ?? "").trim();
    if (!novoNome) return;

    await updateDoc(doc(db, "usuarios_private", r.id), {
      nome: novoNome,
      nomeAtualizadoPor: uid,
      nomeAtualizadoEm: serverTimestamp(),
    });

    if (hasPub(r.id)) {
      try {
        await updateDoc(doc(db, "usuarios", r.id), {
          nome: novoNome,
          nomeAtualizadoPor: uid,
          nomeAtualizadoEm: serverTimestamp(),
        });
      } catch {}
    }
  }

  async function salvarAutenticado(r: RowPriv) {
    await salvarNomePrivEPub(r);
    if (markVerified[r.id]) {
      await updateDoc(doc(db, "usuarios", r.id), {
        verificado: true,
        verificadoPor: uid,
        verificadoEm: serverTimestamp(),
      });
    }
  }

  async function removerEmailsDosPerfisPublicos() {
    if (limpandoEmails) return;
    const confirma = window.confirm(
      "Remover o campo e-mail dos perfis públicos? Os endereços continuarão na área privada da conta."
    );
    if (!confirma) return;

    setLimpandoEmails(true);
    try {
      const snapshot = await getDocs(collection(db, "usuarios"));
      const legados = snapshot.docs.filter((d) =>
        Object.prototype.hasOwnProperty.call(d.data(), "email")
      );
      for (let offset = 0; offset < legados.length; offset += 450) {
        const batch = writeBatch(db);
        legados.slice(offset, offset + 450).forEach((d) => {
          batch.update(d.ref, { email: deleteField() });
        });
        await batch.commit();
      }
      alert(`${legados.length} perfil(is) público(s) revisado(s).`);
    } catch (error) {
      console.error("Falha ao remover e-mails dos perfis públicos:", error);
      alert("Não foi possível concluir a limpeza. Verifique sua conexão e suas permissões de administrador.");
    } finally {
      setLimpandoEmails(false);
    }
  }

  async function excluirUsuario(r: RowPriv, motivo?: "fc_falso" | "nao_verificado") {
    const confirmMsg =
      motivo === "nao_verificado"
        ? `Confirma excluir o usuário NÃO AUTENTICADO?\n\n${r.email || "(sem e-mail)"}`
        : `Digite o e-mail para confirmar a exclusão (motivo: FC falso):\n${r.email || "(sem e-mail)"}`;

    if (motivo === "nao_verificado") {
      if (!window.confirm(confirmMsg)) return;
    } else {
      const conf = window.prompt(confirmMsg);
      if ((r.email || "").toLowerCase() !== (conf || "").trim().toLowerCase()) {
        alert("Confirmação cancelada.");
        return;
      }
    }

    try {
      await fnDelete({ targetUid: r.id }); // Auth + /usuarios + /usuarios_private
      alert("Usuário excluído.");
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Falha ao excluir.");
    }
  }

  async function copyFC(r: RowPriv) {
    const fc = (r.friend_code || "").trim();
    if (!fc) return;
    try {
      await navigator.clipboard.writeText(fc);
      setCopiedFC(r.id);
      setTimeout(() => setCopiedFC(null), 1500);
    } catch {
      alert("Não foi possível copiar o Friend Code.");
    }
  }

  function LinhaAutenticadoNaoVerificado(r: RowPriv) {
    const hasFC = !!(r.friend_code && r.friend_code.trim());
    return (
      <li
        key={r.id}
        className="bg-white border rounded p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium break-all">{r.email || "(sem e-mail)"}</p>
          <p className="text-xs text-gray-600 break-all">UID: {r.id}</p>

          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-xs text-gray-600 break-all">
              Friend code: {r.friend_code || "—"}
            </p>
            <button
              type="button"
              disabled={!hasFC}
              onClick={() => copyFC(r)}
              className={`text-[11px] px-2 py-0.5 rounded border ${
                hasFC
                  ? "border-gray-300 hover:bg-gray-100"
                  : "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
              }`}
              title={hasFC ? "Copiar FC" : "Sem FC"}
            >
              {copiedFC === r.id ? "✅ Copiado" : "📋 Copiar"}
            </button>
          </div>

          <div className="mt-2 flex items-center gap-3">
            <label className="text-xs text-gray-500">Nome</label>
            <input
              className="border rounded px-2 py-1 text-sm"
              value={editing[r.id] ?? r.nome ?? ""}
              onChange={(e) => setEditing((s) => ({ ...s, [r.id]: e.target.value }))}
              placeholder="Nome do jogador"
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!markVerified[r.id]}
                onChange={(e) =>
                  setMarkVerified((s) => ({ ...s, [r.id]: e.target.checked }))
                }
              />
              Verificado
            </label>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => salvarAutenticado(r)}
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
    const hasFC = !!(r.friend_code && r.friend_code.trim());
    return (
      <li
        key={r.id}
        className="bg-white border rounded p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium break-all">{r.email || "(sem e-mail)"}</p>
          <p className="text-xs text-gray-600 break-all">UID: {r.id}</p>

          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-xs text-gray-600 break-all">
              Friend code: {r.friend_code || "—"}
            </p>
            <button
              type="button"
              disabled={!hasFC}
              onClick={() => copyFC(r)}
              className={`text-[11px] px-2 py-0.5 rounded border ${
                hasFC
                  ? "border-gray-300 hover:bg-gray-100"
                  : "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
              }`}
              title={hasFC ? "Copiar FC" : "Sem FC"}
            >
              {copiedFC === r.id ? "✅ Copiado" : "📋 Copiar"}
            </button>
          </div>

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
            onClick={() => salvarNomePrivEPub(r)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-3 py-2 rounded"
          >
            Salvar
          </button>
          <button
            onClick={() => excluirUsuario(r, "nao_verificado")}
            className="bg-red-600 hover:bg-red-700 text-white text-sm px-3 py-2 rounded"
          >
            Excluir não autenticado
          </button>
        </div>
      </li>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">Admin · Verificação de usuários</h1>

      <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
        <p>Faça a limpeza dos e-mails que possam ter ficado em perfis públicos antigos.</p>
        <button
          type="button"
          onClick={removerEmailsDosPerfisPublicos}
          disabled={limpandoEmails}
          className="mt-2 rounded bg-amber-700 px-3 py-2 text-white hover:bg-amber-800"
        >
          {limpandoEmails ? "Removendo e-mails…" : "Remover e-mails dos perfis públicos"}
        </button>
      </div>

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
        <h2 className="text-lg font-semibold">
          Autenticados (aguardando verificação) ({autenticadosNaoVerificados.length})
        </h2>
        {autenticadosNaoVerificados.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum.</p>
        ) : (
          <ul className="space-y-2">{autenticadosNaoVerificados.map(LinhaAutenticadoNaoVerificado)}</ul>
        )}
      </section>
    </div>
  );
}
