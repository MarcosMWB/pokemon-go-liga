'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { FiltroUsuarios } from './FiltroUsuarios';

type UsuarioLista = { id: string; nome: string };

export default function JogadoresPage() {
  const [usuarios, setUsuarios] = useState<UsuarioLista[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(false);
    try {
      const snap = await getDocs(query(collection(db, 'usuarios'), orderBy('nome', 'asc')));
      const list: UsuarioLista[] = snap.docs.map((usuario) => {
        const nome = usuario.data().nome;
        return { id: usuario.id, nome: typeof nome === 'string' && nome.trim() ? nome.trim() : 'Treinador' };
      });
      setUsuarios(list);
    } catch (cause) {
      console.error('Não foi possível carregar os jogadores:', cause);
      setErro(true);
      setUsuarios([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-9">
      <header className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-950 via-blue-900 to-indigo-900 px-5 py-7 text-white shadow-lg sm:px-8 sm:py-9">
        <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-16 h-56 w-56 rounded-full border-[26px] border-white/5" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 right-28 h-48 w-48 rounded-full bg-cyan-400/10 blur-2xl" />
        <div className="relative max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-200">Comunidade da Região Oceânica</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Treinadores da Liga</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-blue-100 sm:text-base">
            Encontre os participantes da comunidade e abra um perfil para conhecer suas insígnias, equipes e conquistas.
          </p>
          <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-sm font-semibold backdrop-blur">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-300" />
            {loading ? 'Atualizando lista…' : `${usuarios.length} ${usuarios.length === 1 ? 'treinador' : 'treinadores'} na comunidade`}
          </div>
        </div>
      </header>

      {loading ? (
        <section aria-label="Carregando jogadores" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="h-5 w-44 animate-pulse rounded bg-slate-200" />
          <div className="mt-4 h-12 animate-pulse rounded-xl bg-slate-100" />
          <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => <div key={index} className="h-[76px] animate-pulse rounded-xl bg-slate-100" />)}
          </div>
          <p className="mt-4 text-center text-sm text-slate-500">Carregando os treinadores…</p>
        </section>
      ) : erro ? (
        <section role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 sm:p-7">
          <h2 className="text-lg font-bold text-amber-950">Não foi possível carregar a lista</h2>
          <p className="mt-1 text-sm text-amber-900">Confira sua conexão e tente novamente. Seus dados de conta não foram alterados.</p>
          <button type="button" onClick={() => void carregar()} className="mt-4 rounded-lg bg-amber-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:ring-offset-2">
            Tentar novamente
          </button>
        </section>
      ) : usuarios.length > 0 ? (
        <FiltroUsuarios usuarios={usuarios} />
      ) : (
        <section className="rounded-2xl border border-slate-200 bg-white px-5 py-12 text-center shadow-sm">
          <span aria-hidden="true" className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-xl">👋</span>
          <h2 className="font-semibold text-slate-900">A lista ainda está vazia</h2>
          <p className="mt-1 text-sm text-slate-600">Quando os treinadores criarem seus perfis, eles vão aparecer aqui.</p>
          <Link href="/cadastro" className="mt-4 inline-flex rounded-lg bg-blue-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2">Participar da Liga</Link>
        </section>
      )}
    </main>
  );
}
