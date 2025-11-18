"use client";

import type { User } from "firebase/auth";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";

type Liga = {
  id: string;
  nome: string;
};

export default function DevLigasPage() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [ligas, setLigas] = useState<Liga[]>([]);
  const [novaLiga, setNovaLiga] = useState("");
  const [msg, setMsg] = useState("");

  // 1) auth + checar superusers
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (current: User | null) => {
      if (!current) {
        router.replace("/login");
        return;
      }

      // confere se esse uid está na coleção superusers
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

  // 2) carregar ligas existentes (só se for admin)
  useEffect(() => {
    if (isAdmin !== true) return;

    (async () => {
      const snap = await getDocs(collection(db, "ligas"));
      const list: Liga[] = snap.docs.map((d) => ({
        id: d.id,
        nome: (d.data() as any).nome || d.id,
      }));
      setLigas(list);
    })();
  }, [isAdmin]);

  const handleCriarLiga = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg("");

    const nome = novaLiga.trim();
    if (!nome) {
      setMsg("Informe o nome da liga.");
      return;
    }

    try {
      // salva no firestore
      await addDoc(collection(db, "ligas"), {
        nome,
        createdAt: Date.now(),
      });
      setMsg("Liga criada!");
      setNovaLiga("");

      // recarrega lista
      const snap = await getDocs(collection(db, "ligas"));
      const list: Liga[] = snap.docs.map((d) => ({
        id: d.id,
        nome: (d.data() as any).nome || d.id,
      }));
      setLigas(list);
    } catch (err: any) {
      setMsg(err.message || "Erro ao criar liga.");
    }
  };

  if (isAdmin === null) {
    return <p className="p-8">Carregando…</p>;
  }

  if (isAdmin === false) {
    // já redirecionou, então não precisa renderizar nada
    return null;
  }

  return (
    <div className="max-w-xl mx-auto p-6 space-y-6 bg-white rounded shadow">
      <div>
        <h1 className="text-2xl font-bold">Admin / Ligas</h1>
        <p className="text-sm text-gray-500">
          Crie e gerencie nomes de ligas usados pelos ginásios.
        </p>
      </div>

      <form onSubmit={handleCriarLiga} className="space-y-3">
        <label className="block text-sm font-medium">
          Nome da liga
          <input
            value={novaLiga}
            onChange={(e) => setNovaLiga(e.target.value)}
            placeholder="Ex.: Great, Ultra, Master..."
            className="mt-1 w-full border rounded px-3 py-2 text-black"
          />
        </label>
        <button
          type="submit"
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm"
        >
          Criar liga
        </button>
        {msg && <p className="text-sm mt-1">{msg}</p>}
      </form>

      <div>
        <h2 className="text-lg font-semibold mb-2">Ligas existentes</h2>
        {ligas.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhuma liga criada ainda.</p>
        ) : (
          <ul className="space-y-1">
            {ligas.map((l) => (
              <li
                key={l.id}
                className="flex items-center justify-between border rounded px-3 py-2"
              >
                <span>{l.nome}</span>
                {/* se quiser, depois dá pra pôr botão de excluir aqui */}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
