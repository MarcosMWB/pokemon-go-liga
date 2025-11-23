"use client";

import { useEffect, useState } from "react";
import { db } from "@/lib/firebase";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";

type Elite = { id: string; liga: string; pos: 1 | 2 | 3 | 4; uid: string };
type HistoricoItem = {
  id: string;
  campeonato_id: string;
  liga: string;
  appliedAt: number; // ms
  top4: Array<{ pos: number; uid: string; nome?: string; pontos?: number }>;
};

function toMillis(v: any): number {
  if (!v) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "object" && "seconds" in v) {
    const s = v.seconds ?? 0;
    const ns = v.nanoseconds ?? 0;
    return s * 1000 + Math.floor(ns / 1e6);
  }
  return Number(v) || 0;
}

export default function PlacarClient({ liga }: { liga: string }) {
  const [elite, setElite] = useState<Elite[]>([]);
  const [historico, setHistorico] = useState<HistoricoItem[]>([]);

  useEffect(() => {
    // Elite atual (ordenado por pos)
    const qE = query(
      collection(db, "elite4"),
      where("liga", "==", liga),
      orderBy("pos", "asc")
    );
    const unsubE = onSnapshot(qE, (snap) => {
      const arr: Elite[] = [];
      snap.forEach((d) => {
        const x = d.data() as any;
        if ([1, 2, 3, 4].includes(x.pos)) {
          arr.push({
            id: d.id,
            liga: x.liga,
            pos: x.pos as 1 | 2 | 3 | 4,
            uid: x.uid,
          });
        }
      });
      setElite(arr);
    });

    // Histórico (mais recente primeiro)
    const qH = query(
      collection(db, "campeonatos_elite4_resultados"),
      where("liga", "==", liga),
      orderBy("appliedAt", "desc")
    );
    const unsubH = onSnapshot(qH, (snap) => {
      const arr: HistoricoItem[] = snap.docs.map((d) => {
        const x = d.data() as any;
        return {
          id: d.id,
          campeonato_id: x.campeonato_id,
          liga: x.liga,
          appliedAt: toMillis(x.appliedAt),
          top4: Array.isArray(x.top4) ? x.top4 : [],
        };
      });
      setHistorico(arr);
    });

    return () => {
      unsubE();
      unsubH();
    };
  }, [liga]);

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">ELITE 4 — Liga {liga}</h1>
      </div>

      <div className="bg-white p-4 rounded shadow">
        <h2 className="text-lg font-semibold mb-2">Atual</h2>
        <ol className="space-y-2">
          {[1, 2, 3, 4].map((pos) => {
            const e = elite.find((x) => x.pos === (pos as 1 | 2 | 3 | 4));
            return (
              <li
                key={pos}
                className="flex items-center justify-between bg-gray-50 rounded px-3 py-2"
              >
                <span>Posição {pos}</span>
                <span className="font-medium">{e?.uid || "—"}</span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="bg-white p-4 rounded shadow">
        <h2 className="text-lg font-semibold mb-2">Histórico</h2>
        {historico.length === 0 ? (
          <p className="text-sm text-gray-500">Sem registros.</p>
        ) : (
          <ul className="space-y-3">
            {historico.map((h) => (
              <li key={h.id} className="bg-gray-50 rounded p-3">
                <p className="text-xs text-gray-500">
                  Aplicado: {h.appliedAt ? new Date(h.appliedAt).toLocaleString() : "—"}
                </p>
                <ol className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {h.top4.slice(0, 4).map((t) => (
                    <li
                      key={t.pos}
                      className="flex items-center justify-between bg-white rounded border px-3 py-2"
                    >
                      <span>{t.pos}º</span>
                      <span className="font-medium">{t.nome || t.uid || "—"}</span>
                      <span className="text-xs text-gray-500">
                        {t.pontos ?? 0} pts
                      </span>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}