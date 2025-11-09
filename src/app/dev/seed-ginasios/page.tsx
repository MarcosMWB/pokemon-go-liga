"use client";

import { useState } from "react";
import { db } from "@/lib/firebase";
import { collection, addDoc } from "firebase/firestore";

const GINASIOS = [
  { nome: "Jardim Imbuí", tipo: "" },
  { nome: "Piratininga", tipo: "" },
  { nome: "Cafubá", tipo: "" },
  { nome: "Jacaré", tipo: "" },
  { nome: "Camboinhas", tipo: "" },
  { nome: "Maravista", tipo: "" },
  { nome: "Itaipu", tipo: "" },
  { nome: "Itacoatiara", tipo: "" },
  { nome: "Serra Grande", tipo: "" },
  { nome: "Engenho do Mato", tipo: "" },
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
          lider_uid: "",
          lider_whatsapp: "",
          em_disputa: false,
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
