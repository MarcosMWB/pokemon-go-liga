"use client";

import { useState } from "react";
import { db } from "@/lib/firebase";
import { collection, addDoc } from "firebase/firestore";

const GINASIOS = [
  { nome: "Jardim Imbuí",  tipo: "", icon: "/Insignia/jardimimbui.png" },
  { nome: "Piratininga",   tipo: "", icon: "/Insignia/piratininga.png" },
  { nome: "Cafubá",        tipo: "", icon: "/Insignia/cafuba.png" },
  { nome: "Jacaré",        tipo: "", icon: "/Insignia/jacare.png" },
  { nome: "Camboinhas",    tipo: "", icon: "/Insignia/camboinhas.png" },
  { nome: "Maravista",     tipo: "", icon: "/Insignia/maravista.png" },
  { nome: "Itaipu",        tipo: "", icon: "/Insignia/itaipu.png" },
  { nome: "Itacoatiara",   tipo: "", icon: "/Insignia/itacoatiara.png" },
  { nome: "Serra Grande",  tipo: "", icon: "/Insignia/serragrande.png" },
  { nome: "Engenho do Mato", tipo: "", icon: "/Insignia/engenhodomato.png" },
];


export default function SeedGinasiosPage() {
  const [msg, setMsg] = useState("");

  const handleSeed = async () => {
    setMsg("Criando...");
    try {
      for (const g of GINASIOS) {
        await addDoc(collection(db, "ginasios"), {
          nome: g.nome,
          tipo: g.tipo,        // vazio por enquanto
          insignia_icon: g.icon,
          lider_uid: "",
          lider_whatsapp: "",
          em_disputa: false,
          liga: "Master"
        });
      }
      setMsg("Pronto! Veja no Firestore.");
    } catch (e: any) {
      setMsg("Erro: " + e.message);
    }
  };

  return (
    <div className="p-8">
      <h1 className="text-xl mb-4">Semear ginásios</h1>
      <button
        onClick={handleSeed}
        className="bg-blue-600 text-white px-4 py-2 rounded"
      >
        Criar 10 ginásios
      </button>
      {msg && <p className="mt-4">{msg}</p>}
    </div>
  );
}
