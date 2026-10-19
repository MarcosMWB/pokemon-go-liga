// src/app/elite4/placar/PlacarClient.tsx
"use client";

import { useEffect, useState } from "react";
import { db } from "@/lib/firebase";
import { collection, doc, getDoc, onSnapshot, orderBy, query, where } from "firebase/firestore";

type Elite = { id: string; liga: string; pos: 1 | 2 | 3 | 4; uid: string; nome?: string; tipo?: string };
type HistoricoItem = {
  id: string;
  campeonato_id: string;
  liga: string;
  appliedAt: number; // ms
  top4: Array<{ pos: number; uid: string; nome?: string; pontos?: number }>;
};
type RankingItem = { id: string; uid: string; nome: string; tipo: "lider" | "elite4"; posElite?: number; pontos: number; participacao: number; vitorias: number; admin: number };

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
  const [campeonatoAbertoId, setCampeonatoAbertoId] = useState<string | null>(null);
  const [ranking, setRanking] = useState<RankingItem[]>([]);

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
            nome: x.nome,
            tipo: x.tipo,
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

    const qAtivo = query(collection(db, "campeonatos_elite4"), where("liga", "==", liga), where("status", "==", "aberto"), orderBy("createdAt", "desc"));
    const unsubAtivo = onSnapshot(qAtivo, (snap) => setCampeonatoAbertoId(snap.docs[0]?.id || null));

    return () => {
      unsubE();
      unsubH();
      unsubAtivo();
    };
  }, [liga]);

  useEffect(() => {
    if (!campeonatoAbertoId) { setRanking([]); return; }
    return onSnapshot(collection(db, "campeonatos_elite4", campeonatoAbertoId, "participantes"), async (snap) => {
      const rows = await Promise.all(snap.docs.filter((d) => d.data().tipo_participante === "elite4" || d.data().optou_participar === true).map(async (d) => {
        const x = d.data() as any;
        const uid = String(x.usuario_uid || d.id);
        const user = await getDoc(doc(db, "usuarios", uid));
        return {
          id: d.id, uid, nome: String(user.data()?.nome || user.data()?.nick || uid),
          tipo: x.tipo_participante === "elite4" ? "elite4" as const : "lider" as const,
          posElite: Number(x.elite4_pos) || undefined, pontos: Number(x.pontos || 0),
          participacao: Number(x.pontos_participacao || 0), vitorias: Number(x.pontos_vitoria || 0), admin: Number(x.pontos_admin || 0),
        };
      }));
      setRanking(rows.sort((a, b) => b.pontos - a.pontos || b.vitorias - a.vitorias || b.participacao - a.participacao || a.nome.localeCompare(b.nome, "pt-BR")));
    });
  }, [campeonatoAbertoId]);

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
                <span className="text-right"><span className="block font-medium">{e?.nome || e?.uid || "—"}</span>{e?.tipo && <span className="text-xs capitalize text-slate-500">Tipo {e.tipo}</span>}</span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="bg-white p-4 rounded shadow">
        <h2 className="text-lg font-semibold mb-2">Disputa da Elite 4 — classificação atual</h2>
        {!campeonatoAbertoId ? <p className="text-sm text-gray-500">Não há disputa aberta nesta liga.</p> : ranking.length === 0 ? <p className="text-sm text-gray-500">Carregando participantes…</p> : (
          <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">#</th><th>Treinador</th><th>Categoria</th><th>Participação</th><th>Bônus vitória</th><th>Admin</th><th>Total</th></tr></thead><tbody>{ranking.map((p, i) => <tr key={p.id} className="border-b"><td className="p-2">{i + 1}</td><td>{p.nome}</td><td>{p.tipo === "elite4" ? `Elite 4 · posição ${p.posElite || "—"}` : "Líder de ginásio"}</td><td>{p.participacao}</td><td>{p.vitorias}</td><td>{p.admin}</td><td className="font-semibold">{p.pontos}</td></tr>)}</tbody></table></div>
        )}
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
