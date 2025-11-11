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

type Liga = {
  id: string;
  nome: string;
};

export default function SeedGinasiosPage() {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  const [ligas, setLigas] = useState<Liga[]>([]);
  const [selectedLiga, setSelectedLiga] = useState<string>("");

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
    (async () => {
      try {
        const snap = await getDocs(collection(db, "ligas"));
        const list: Liga[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            nome: data.nome || d.id,
          };
        });
        setLigas(list);
        if (list.length > 0) {
          setSelectedLiga(list[0].nome);
        }
      } catch (e) {
        // se der erro, deixa vazio e o seed cai pra "Master"
      }
    })();
  }, []);

  const handleSeed = async () => {
    setMsg("Criando...");
    try {
      const ligaParaSalvar = selectedLiga || "Master";

      for (const g of GINASIOS) {
        await addDoc(collection(db, "ginasios"), {
          nome: g.nome,
          tipo: g.tipo,
          insignia_icon: g.icon,
          lider_uid: "",
          lider_whatsapp: "",
          em_disputa: false,
          liga: ligaParaSalvar,
        });
      }
      setMsg("Pronto! Veja no Firestore.");
    } catch (e: any) {
      setMsg("Erro: " + e.message);
    }
  };

  if (isAdmin === null) return <p className="p-8">Carregando…</p>;
  if (isAdmin === false) return null; // já redirecionou

  return (
    <div className="p-8 space-y-4">
      <h1 className="text-xl mb-2 font-semibold">Semear ginásios</h1>

      <div>
        <label className="block text-sm text-gray-600 mb-1">
          Liga para criar os ginásios
        </label>
        <select
          value={selectedLiga}
          onChange={(e) => setSelectedLiga(e.target.value)}
          className="border rounded px-3 py-1 text-sm"
        >
          {ligas.length === 0 ? (
            <option value="">(sem ligas) — vai salvar como "Master"</option>
          ) : (
            ligas.map((l) => (
              <option key={l.id} value={l.nome}>
                {l.nome}
              </option>
            ))
          )}
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
