"use client";

import { useEffect, useState } from "react";
import { db, auth } from "@/lib/firebase";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { FiltroUsuarios } from "./FiltroUsuarios";

type UsuarioLista = {
  id: string;
  nome: string;
};

export default function JogadoresPage() {
  const [usuarios, setUsuarios] = useState<UsuarioLista[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (!user) {
        setUsuarios([]);
        setLoading(false);
        return;
      }

      try {
        const q = query(collection(db, "usuarios"), orderBy("nome", "asc"));
        const snap = await getDocs(q);

        const list: UsuarioLista[] = [];
        snap.forEach((docu) => {
          const data = docu.data() as any;
          list.push({
            id: docu.id,
            // aqui eu GARANTO que é string
            nome: typeof data.nome === "string" ? data.nome : "(sem nome)",
          });
        });

        setUsuarios(list);
      } catch (e) {
        console.error(e);
        setUsuarios([]);
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, []);

  return (
    <div className="max-w-xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Jogadores</h1>
      {loading ? (
        <p>Carregando...</p>
      ) : usuarios.length > 0 ? (
        <FiltroUsuarios usuarios={usuarios} />
      ) : (
        <p>Não foi possível carregar os usuários.</p>
      )}
    </div>
  );
}
