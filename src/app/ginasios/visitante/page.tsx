// app/ginasios/visitante/page.tsx
"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { db } from "@/lib/firebase";
import { collection, onSnapshot } from "firebase/firestore";
import { TYPE_ICONS } from "@/utils/typeIcons";

type Ginasio = {
  id: string;
  nome: string;
  tipo?: string;
  liga?: string;
  insignia_icon?: string;
};

export default function GinasiosVisitantePage() {
  const [ginasios, setGinasios] = useState<Ginasio[]>([]);
  const [ligas, setLigas] = useState<string[]>([]);
  const [ligaSelecionada, setLigaSelecionada] = useState<string>("");

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "ginasios"), (snap) => {
      const list: Ginasio[] = snap.docs.map((d) => {
        const x = d.data() as any;
        return {
          id: d.id,
          nome: x.nome || d.id,
          tipo: x.tipo || "",
          liga: x.liga || "",
          insignia_icon: x.insignia_icon || "",
        };
      });
      setGinasios(list);

      const uniq = Array.from(new Set(list.map((g) => g.liga).filter(Boolean))) as string[];
      setLigas(uniq);
      if (!ligaSelecionada && uniq.length) setLigaSelecionada(uniq[0]);
    });
    return () => unsub();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtrados = ligaSelecionada
    ? ginasios.filter((g) => (g.liga || "") === ligaSelecionada)
    : ginasios;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Ginásios</h1>

        <div className="flex items-center gap-2">
          {ligas.length > 0 && (
            <select
              value={ligaSelecionada}
              onChange={(e) => setLigaSelecionada(e.target.value)}
              className="border rounded px-2 py-1 text-sm"
            >
              <option value="">Todas as ligas</option>
              {ligas.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* GRID DE CARDS — sem botões/ações */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtrados.map((g) => (
          <div
            key={g.id}
            className="bg-white border rounded-lg p-4 shadow-sm flex items-center gap-3"
          >
            {/* Ícone da insígnia (se existir) */}
            {g.insignia_icon ? (
              <Image
                src={g.insignia_icon}
                alt={g.nome}
                width={48}
                height={48}
                className="w-12 h-12 object-contain"
              />
            ) : (
              <div className="w-12 h-12 rounded bg-gray-100" />
            )}

            <div className="min-w-0">
              <p className="text-sm text-gray-500 truncate">
                {g.liga ? `Liga: ${g.liga}` : "Liga não definida"}
              </p>
              <h2 className="text-base font-semibold truncate">{g.nome}</h2>
              <p className="text-sm text-gray-600 flex items-center gap-2 mt-1">
                Tipo:
                {g.tipo ? (
                  <>
                    {TYPE_ICONS[g.tipo] && (
                      <Image
                        src={TYPE_ICONS[g.tipo]}
                        alt={g.tipo}
                        width={18}
                        height={18}
                      />
                    )}
                    <span>{g.tipo}</span>
                  </>
                ) : (
                  <span>não definido</span>
                )}
              </p>
            </div>
          </div>
        ))}
      </div>

      {filtrados.length === 0 && (
        <p className="text-sm text-gray-500">Nenhum ginásio encontrado.</p>
      )}
    </div>
  );
}
