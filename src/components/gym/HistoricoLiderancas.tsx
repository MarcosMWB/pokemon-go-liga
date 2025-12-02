"use client";

import { formatDate, toMillis } from "@/utils/datetime";

export type LiderancaItem = {
  id: string;
  lider_uid: string | null;
  nome?: string;
  origem?: "disputa" | "renuncia" | "3_derrotas" | "manual" | "empate";
  tipo_no_periodo?: string;
  inicio: any;
  fim: any | null;
};

export default function HistoricoLiderancas({
  items,
}: {
  items: LiderancaItem[];
}) {
  if (!items || items.length === 0) {
    return <p className="text-sm text-gray-500">Sem registros.</p>;
  }

  return (
    <ul className="space-y-2">
      {items.map((h) => {
        const inicioMs = toMillis(h.inicio);
        const fimMs = toMillis(h.fim);
        return (
          <li
            key={h.id}
            className="flex flex-col sm:flex-row sm:items-center sm:justify-between bg-gray-50 rounded px-3 py-2"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{h.nome || h.lider_uid || "—"}</p>
              <p className="text-xs text-gray-600">
                Origem: {h.origem || "—"}
                {h.tipo_no_periodo ? (
                  <>
                    {" · "}Tipo no período: <span className="capitalize">{h.tipo_no_periodo}</span>
                  </>
                ) : null}
              </p>
            </div>
            <div className="text-xs text-gray-600 mt-1 sm:mt-0 sm:text-right">
              <div>Início: {formatDate(inicioMs)}</div>
              <div>Fim: {fimMs ? formatDate(fimMs) : "em curso/—"}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
