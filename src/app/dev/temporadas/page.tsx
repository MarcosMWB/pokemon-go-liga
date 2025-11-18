// src/app/dev/temporadas/page.tsx
"use client";

import type { User } from "firebase/auth";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  onSnapshot,
  getDocs,
  addDoc,
  updateDoc,
  doc,
} from "firebase/firestore";

type Temporada = {
  id: string;
  nome: string;
  ativa: boolean;
  createdAt?: number;
};

export default function DevTemporadasPage() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [temporadas, setTemporadas] = useState<Temporada[]>([]);
  const [novoNome, setNovoNome] = useState("");
  const [msg, setMsg] = useState("");

  // 1) checar se é superuser
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (current: User | null) => {
      if (!current) {
        router.replace("/login");
        return;
      }

      const q = query(
        collection(db, "superusers"),
        where("uid", "==", current.uid)
      );
      const snap = await getDocs(q);
      if (snap.empty) {
        setIsAdmin(false);
        router.replace("/");
        return;
      }

      setIsAdmin(true);
    });

    return () => unsub();
  }, [router]);

  // 2) ouvir temporadas
  useEffect(() => {
    if (isAdmin !== true) return;

    const unsub = onSnapshot(collection(db, "temporadas"), (snap) => {
      const list: Temporada[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          nome: data.nome || d.id,
          ativa: data.ativa === true,
          createdAt: data.createdAt,
        };
      });

      // ordena: ativa primeiro, depois por createdAt desc
      list.sort((a, b) => {
        if (a.ativa && !b.ativa) return -1;
        if (!a.ativa && b.ativa) return 1;
        return (b.createdAt || 0) - (a.createdAt || 0);
      });

      setTemporadas(list);
    });

    return () => unsub();
  }, [isAdmin]);

  const handleCriar = async () => {
    if (!novoNome.trim()) {
      setMsg("Informe um nome.");
      return;
    }
    setMsg("");
    await addDoc(collection(db, "temporadas"), {
      nome: novoNome.trim(),
      ativa: false,
      createdAt: Date.now(),
    });
    setNovoNome("");
  };

  const handleTornarAtiva = async (temp: Temporada) => {
    // desativa todas e ativa só a escolhida
    const ops = temporadas.map((t) =>
      updateDoc(doc(db, "temporadas", t.id), {
        ativa: t.id === temp.id,
      })
    );
    await Promise.all(ops);
  };

  if (isAdmin === null) {
    return <p className="p-8">Carregando…</p>;
  }

  if (isAdmin === false) {
    return null; // já redirecionou
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">DEV / Temporadas</h1>
        <p className="text-sm text-gray-500">
          Crie novas temporadas e marque qual está ativa no momento.
        </p>
      </div>

      {/* criar nova */}
      <div className="bg-white border rounded p-4 space-y-3">
        <h2 className="font-semibold">Criar nova temporada</h2>
        <div className="flex gap-2 max-sm:flex-col">
          <input
            value={novoNome}
            onChange={(e) => setNovoNome(e.target.value)}
            placeholder="Ex: Temporada 2025 / Liga Great"
            className="flex-1 border rounded px-3 py-2 text-sm"
          />
          <button
            onClick={handleCriar}
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm"
          >
            Criar
          </button>
        </div>
        {msg && <p className="text-sm text-red-500">{msg}</p>}
      </div>

      {/* lista de temporadas */}
      <div className="bg-white border rounded p-4 space-y-3">
        <h2 className="font-semibold">Temporadas existentes</h2>
        {temporadas.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhuma temporada ainda.</p>
        ) : (
          <ul className="space-y-2">
            {temporadas.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between bg-slate-50 rounded px-3 py-2"
              >
                <div>
                  <p className="font-medium flex items-center gap-2">
                    {t.nome}
                    {t.ativa && (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
                        ativa
                      </span>
                    )}
                  </p>
                  {t.createdAt && (
                    <p className="text-xs text-gray-400">
                      {new Date(t.createdAt).toLocaleString()}
                    </p>
                  )}
                </div>
                {!t.ativa && (
                  <button
                    onClick={() => handleTornarAtiva(t)}
                    className="text-xs bg-purple-500 text-white px-3 py-1 rounded"
                  >
                    Tornar ativa
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
