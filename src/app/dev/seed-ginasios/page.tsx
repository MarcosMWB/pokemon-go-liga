"use client";

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

const GINASIOS = [
  { nome: "Jardim Imbuí", tipo: "", icon: "/Insignia/jardimimbui.png" },
  { nome: "Piratininga", tipo: "", icon: "/Insignia/piratininga.png" },
  { nome: "Cafubá", tipo: "", icon: "/Insignia/cafuba.png" },
  { nome: "Jacaré", tipo: "", icon: "/Insignia/jacare.png" },
  { nome: "Camboinhas", tipo: "", icon: "/Insignia/camboinhas.png" },
  { nome: "Maravista", tipo: "", icon: "/Insignia/maravista.png" },
  { nome: "Itaipu", tipo: "", icon: "/Insignia/itaipu.png" },
  { nome: "Itacoatiara", tipo: "", icon: "/Insignia/itacoatiara.png" },
  { nome: "Serra Grande", tipo: "", icon: "/Insignia/serragrande.png" },
  { nome: "Engenho do Mato", tipo: "", icon: "/Insignia/engenhodomato.png" },
];

export default function SeedGinasiosPage() {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [ligas, setLigas] = useState<{ id: string; nome: string }[]>([]);
  const [ligaSelecionada, setLigaSelecionada] = useState("");

  // checar auth + superusers
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }

      const q = query(
        collection(db, "superusers"),
        where("uid", "==", user.uid)
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

  // carregar ligas
  useEffect(() => {
    if (isAdmin !== true) return;

    (async () => {
      const snap = await getDocs(collection(db, "ligas"));
      const list = snap.docs.map((d) => {
        const data = d.data() as any;
        return { id: d.id, nome: data.nome as string };
      });
      setLigas(list);
      if (list.length > 0) {
        setLigaSelecionada(list[0].nome);
      }
    })();
  }, [isAdmin]);

  const handleSeed = async () => {
    if (!ligaSelecionada) {
      setMsg("Escolha uma liga primeiro.");
      return;
    }

    setMsg("Criando...");
    try {
      for (const g of GINASIOS) {
        await addDoc(collection(db, "ginasios"), {
          nome: g.nome,
          tipo: g.tipo,
          insignia_icon: g.icon,
          lider_uid: "",
          lider_whatsapp: "",
          em_disputa: false,
          liga: ligaSelecionada,
        });
      }
      setMsg("Pronto! Veja no Firestore.");
    } catch (err: any) {
      // usamos o err pra não dar eslint
      setMsg("Erro: " + (err?.message || "não foi possível criar"));
    }
  };

  if (isAdmin === null) return <p className="p-8">Carregando…</p>;
  if (isAdmin === false) return null; // já redirecionou

  return (
    <div className="p-8 space-y-4">
      <h1 className="text-xl mb-2 font-bold">Semear ginásios</h1>

      <div className="flex gap-2 items-center">
        <label className="text-sm text-gray-700">Liga:</label>
        <select
          value={ligaSelecionada}
          onChange={(e) => setLigaSelecionada(e.target.value)}
          className="border rounded px-2 py-1"
        >
          {ligas.map((l) => (
            <option key={l.id} value={l.nome}>
              {l.nome}
            </option>
          ))}
        </select>
      </div>

      <button
        onClick={handleSeed}
        className="bg-blue-600 text-white px-4 py-2 rounded"
      >
        Criar 10 ginásios
      </button>
      {msg && <p className="mt-4 text-sm">{msg}</p>}
    </div>
  );
}
