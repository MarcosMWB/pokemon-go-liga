"use client";
import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";

export default function CampeonatosROPage(){
  const [rows,setRows]=useState<Array<Record<string,any>>>([]);
  useEffect(()=>onSnapshot(collection(db,"campeonatos_liga_ro"),s=>{const list:Record<string,any>[]=s.docs.map(d=>({id:d.id,...d.data()}));list.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));setRows(list);}),[]);
  return <main className="mx-auto max-w-4xl space-y-5 p-6"><header><h1 className="text-3xl font-bold">Great Plateau — Liga RO</h1><p className="text-gray-600">Campeonatos, classificações e salas de batalha.</p></header><a href="/desafio-dos-campeoes" className="inline-block rounded bg-amber-600 px-4 py-2 text-white">Desafio dos Campeões</a><div className="space-y-3">{rows.map(t=><a key={t.id} href={`/campeonato-ro/${t.id}`} className="block rounded-lg border p-4 hover:bg-slate-50"><div className="flex justify-between gap-3"><b>{t.nome||`Liga RO — ${t.temporada_nome}`}</b><span className="text-sm">{String(t.status).replaceAll("_"," ")}</span></div><p className="mt-1 text-sm text-gray-600">{t.temporada_nome} · {t.liga} · {t.participantes_count||0} classificados</p>{t.vencedor_nome&&<p className="mt-2 text-amber-800">🏆 Campeão: {t.vencedor_nome}</p>}</a>)}</div>{!rows.length&&<p>Ainda não há campeonato publicado.</p>}</main>
}
