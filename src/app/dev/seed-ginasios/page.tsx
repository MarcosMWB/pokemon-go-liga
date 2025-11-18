// app/dev/seed-ginasios/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import { collection, addDoc, getDocs, doc, getDoc } from "firebase/firestore";

export default function SeedGinasiosPage() {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [ligas, setLigas] = useState<{ id: string; nome: string }[]>([]);
  const [ligaSelecionada, setLigaSelecionada] = useState("");

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (!user) { router.replace("/login"); return; }
      const su = await getDoc(doc(db, "superusers", user.uid));
      if (!su.exists()) { setIsAdmin(false); router.replace("/"); return; }
      setIsAdmin(true);
    });
    return () => unsub();
  }, [router]);

  useEffect(() => {
    if (isAdmin !== true) return;
    (async () => {
      const snap = await getDocs(collection(db, "ligas"));
      const list = snap.docs.map((d) => ({ id: d.id, nome: (d.data() as any).nome as string }));
      setLigas(list);
      if (list.length > 0) setLigaSelecionada(list[0].nome);
    })();
  }, [isAdmin]);

  const handleSeed = async () => {
    if (!ligaSelecionada) { setMsg("Escolha uma liga primeiro."); return; }
    setMsg("Criando...");
    try {
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
      for (const g of GINASIOS) {
        await addDoc(collection(db, "ginasios"), {
          nome: g.nome,
          tipo: g.tipo,
          insignia_icon: g.icon,
          lider_uid: "",
          lider_whatsapp: "",
          em_disputa: false,
          liga: ligaSelecionada,
          createdAt: Date.now(),
        });
      }
      setMsg("Pronto! Veja no Firestore.");
    } catch (err: any) {
      setMsg("Erro: " + (err?.message || "não foi possível criar"));
    }
  };

  if (isAdmin === null) return <p className="p-8">Carregando…</p>;
  if (isAdmin === false) return null;

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
            <option key={l.id} value={l.nome}>{l.nome}</option>
          ))}
        </select>
      </div>
      <button onClick={handleSeed} className="bg-blue-600 text-white px-4 py-2 rounded">
        Criar 10 ginásios
      </button>
      {msg && <p className="mt-4 text-sm">{msg}</p>}
    </div>
  );
}
