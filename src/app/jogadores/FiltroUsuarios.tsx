'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

type UsuarioLista = { id: string; nome: string };

function normalizar(texto: string) {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

function iniciais(nome: string) {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  return (partes.length > 1 ? `${partes[0][0]}${partes[partes.length - 1][0]}` : partes[0]?.slice(0, 2) || 'PG')
    .toLocaleUpperCase('pt-BR');
}

export function FiltroUsuarios({ usuarios }: { usuarios: UsuarioLista[] }) {
  const [busca, setBusca] = useState('');
  const filtrados = useMemo(() => {
    const termo = normalizar(busca.trim());
    return usuarios.filter((usuario) => normalizar(usuario.nome).includes(termo));
  }, [busca, usuarios]);

  return (
    <section aria-label="Lista de treinadores" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-4 sm:p-5">
        <label htmlFor="busca-jogadores" className="mb-2 block text-sm font-semibold text-slate-800">
          Buscar treinador
        </label>
        <div className="relative">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="11" cy="11" r="7" />
            <path d="m16 16 4 4" />
          </svg>
          <input
            id="busca-jogadores"
            type="search"
            placeholder="Digite um nome para filtrar"
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            className="min-h-12 w-full rounded-xl border border-slate-300 bg-slate-50 py-3 pl-10 pr-12 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
            autoComplete="off"
          />
          {busca && (
            <button
              type="button"
              onClick={() => setBusca('')}
              aria-label="Limpar busca"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-sm font-medium text-blue-800 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
            >
              Limpar
            </button>
          )}
        </div>
        <p className="mt-3 text-sm text-slate-600" aria-live="polite">
          {busca.trim()
            ? `${filtrados.length} ${filtrados.length === 1 ? 'treinador encontrado' : 'treinadores encontrados'}`
            : `${usuarios.length} ${usuarios.length === 1 ? 'treinador cadastrado' : 'treinadores cadastrados'}`}
        </p>
      </div>

      {filtrados.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <span aria-hidden="true" className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-xl">🔎</span>
          <h2 className="font-semibold text-slate-900">Nenhum treinador encontrado</h2>
          <p className="mt-1 text-sm text-slate-600">Confira a escrita ou tente buscar por outro nome.</p>
          {busca && <button type="button" onClick={() => setBusca('')} className="mt-4 rounded-lg px-4 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-50">Mostrar todos</button>}
        </div>
      ) : (
        <ul className="grid gap-2 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-3" aria-label="Treinadores">
          {filtrados.map((usuario) => (
            <li key={usuario.id}>
              <Link
                href={`/perfil/${usuario.id}`}
                className="group flex min-h-[76px] items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-blue-300 hover:bg-blue-50/70 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2"
              >
                <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 text-sm font-bold text-blue-900">
                  {iniciais(usuario.nome)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-slate-900 group-hover:text-blue-900">{usuario.nome}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">Ver perfil do treinador</span>
                </span>
                <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-blue-700" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="m7 4 6 6-6 6" />
                </svg>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
