import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { collection, addDoc } from "firebase/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GINASIOS = [
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

export async function GET() {
  // cria os 10
  for (const g of GINASIOS) {
    await addDoc(collection(db, "ginasios"), {
      nome: g.nome,
      tipo: g.tipo,
      lider_uid: "",
      lider_whatsapp: "",
      em_disputa: false,
    });
  }

  return NextResponse.json({ ok: true });
}
