"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, onSnapshot, orderBy, query, updateDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

type NotificationItem = {
  id: string;
  tipo?: string;
  titulo?: string;
  mensagem?: string;
  href?: string;
  lida?: boolean;
  createdAt?: { toDate?: () => Date };
};

export default function NotificationsPage() {
  const [uid, setUid] = useState<string | null>(null);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => onAuthStateChanged(auth, (user) => setUid(user?.uid ?? null)), []);

  useEffect(() => {
    if (!uid) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(collection(db, "notificacoes", uid, "itens"), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snapshot) => {
      setItems(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as NotificationItem));
      setLoading(false);
    }, (error) => {
      console.error("Falha ao carregar notificações", error);
      setLoading(false);
    });
  }, [uid]);

  async function markRead(item: NotificationItem) {
    if (!uid || item.lida) return;
    await updateDoc(doc(db, "notificacoes", uid, "itens", item.id), { lida: true });
  }

  if (!uid) return <main className="mx-auto max-w-3xl p-6"><h1 className="text-2xl font-bold">Notificações</h1><p className="mt-3">Entre na sua conta para ver suas notificações.</p><Link className="text-blue-700 underline" href="/login">Entrar</Link></main>;

  return (
    <main className="mx-auto max-w-3xl p-4">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold">Notificações</h1><p className="text-sm text-slate-600">Avisos de desafios, batalhas e insígnias.</p></div>
        <Link className="rounded bg-slate-100 px-3 py-2 text-sm hover:bg-slate-200" href={`/perfil/${uid}`}>Meu perfil</Link>
      </div>
      {loading ? <p>Carregando…</p> : items.length === 0 ? (
        <div className="rounded border bg-white p-6 text-slate-600">Você ainda não tem notificações.</div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const content = <><div className="flex items-start justify-between gap-3"><h2 className="font-semibold">{item.titulo || "Aviso da Liga"}</h2>{!item.lida && <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">Nova</span>}</div><p className="mt-1 text-sm text-slate-700">{item.mensagem}</p><time className="mt-2 block text-xs text-slate-500">{item.createdAt?.toDate?.().toLocaleString("pt-BR") || ""}</time></>;
            return <li key={item.id} className={`rounded border p-4 ${item.lida ? "bg-white" : "border-blue-200 bg-blue-50"}`}>
              {item.href ? <Link href={item.href} onClick={() => void markRead(item)} className="block">{content}</Link> : <div>{content}</div>}
              {!item.lida && <button onClick={() => void markRead(item)} className="mt-3 text-sm font-medium text-blue-700 underline">Marcar como lida</button>}
            </li>;
          })}
        </ul>
      )}
    </main>
  );
}
