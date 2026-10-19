// app/ginasios/visitante/page.tsx
"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

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
      setLoading(false);
      setLoadError(false);

      const uniq = Array.from(new Set(list.map((g) => g.liga).filter(Boolean))) as string[];
      setLigas(uniq);
      if (!ligaSelecionada && uniq.length) setLigaSelecionada(uniq[0]);
    }, () => { setLoadError(true); setLoading(false); });
    return () => unsub();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtrados = ligaSelecionada
    ? ginasios.filter((g) => (g.liga || "") === ligaSelecionada)
    : ginasios;

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-3 sm:p-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div><h1 className="text-2xl font-bold text-slate-950">Conheça os ginásios</h1><p className="mt-1 max-w-2xl text-base leading-7 text-slate-700">Veja as regiões e os tipos de batalha. Abra um ginásio para conhecer os detalhes e, se quiser desafiar, entre ou crie sua conta.</p></div>
        <div className="flex flex-col gap-1 sm:min-w-48">
          {ligas.length > 0 && <label className="text-sm font-semibold text-slate-700">Filtrar por liga
            <select
              value={ligaSelecionada}
              onChange={(e) => setLigaSelecionada(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-lg border border-slate-400 bg-white px-3 text-base"
            >
              <option value="">Todas as ligas</option>
              {ligas.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>}
        </div>
      </div>

      <p className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-base leading-7 text-blue-950">Para participar de um desafio, <Link href="/login" className="font-bold underline underline-offset-2">entre na sua conta</Link> ou <Link href="/cadastro" className="font-bold underline underline-offset-2">crie uma conta gratuitamente</Link>. Você pode continuar explorando sem entrar.</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtrados.map((g) => (
          <Link
            key={g.id}
            href={`/ginasios/${g.id}`}
            className="flex min-h-28 items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-blue-400 hover:bg-blue-50 focus-visible:ring-2 focus-visible:ring-blue-700"
            aria-label={`Abrir ginásio ${g.nome}, ${g.liga || "liga não definida"}, tipo ${g.tipo || "não definido"}`}
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
              <div aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-slate-100 text-2xl">🏅</div>
            )}

            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-600">
                {g.liga ? `Liga ${g.liga}` : "Liga não definida"}
              </p>
              <h2 className="truncate text-lg font-bold text-slate-950">{g.nome}</h2>
              <p className="mt-1 flex items-center gap-2 text-base text-slate-700">
                Tipo de batalha:
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
            <span aria-hidden="true" className="ml-auto shrink-0 text-2xl text-blue-800">›</span>
          </Link>
        ))}
      </div>

      {loading && <p role="status" className="rounded-lg bg-white p-4 text-base text-slate-700">Carregando os ginásios…</p>}
      {loadError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-base text-red-900">Não foi possível carregar os ginásios agora. Verifique sua conexão e tente novamente.</div>}
      {!loading && !loadError && filtrados.length === 0 && (
        <p className="rounded-lg bg-white p-4 text-base text-slate-700">Não encontramos ginásios nesta liga. Escolha “Todas as ligas” e tente novamente.</p>
      )}
    </div>
  );
}
