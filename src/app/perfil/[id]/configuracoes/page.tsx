'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

export default function ConfiguracoesPerfilPage() {
  const params = useParams();
  const perfilUid = params?.id as string;
  const [uid, setUid] = useState<string | null>(null);
  const [nome, setNome] = useState('');
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setUid(auth.currentUser?.uid ?? null);
    return onAuthStateChanged(auth, (user: User | null) => setUid(user?.uid ?? null));
  }, []);

  useEffect(() => {
    if (!uid || !perfilUid || uid !== perfilUid) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    Promise.all([
      getDoc(doc(db, 'usuarios', perfilUid)),
      getDoc(doc(db, 'usuarios_private', perfilUid)),
    ]).then(([publicProfile, privateProfile]) => {
      if (!active) return;
      setNome(String(publicProfile.data()?.nome || privateProfile.data()?.nome || ''));
      setNotificationsEnabled(privateProfile.data()?.notifications?.enabled === true);
    }).catch((cause) => {
      console.error('Falha ao carregar configurações da conta:', cause);
      if (active) setError('Não foi possível carregar suas configurações. Atualize a página e tente novamente.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [uid, perfilUid]);

  async function salvar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!uid || uid !== perfilUid || saving) return;
    const nomeFinal = nome.trim();
    if (nomeFinal.length < 2 || nomeFinal.length > 40) {
      setError('O nome precisa ter entre 2 e 40 caracteres.');
      setNotice('');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await setDoc(doc(db, 'usuarios', perfilUid), { nome: nomeFinal }, { merge: true });
      await setDoc(doc(db, 'usuarios_private', perfilUid), {
        nome: nomeFinal,
        notifications: { enabled: notificationsEnabled, updatedAt: serverTimestamp() },
      }, { merge: true });
      setNome(nomeFinal);
      setNotice('Configurações salvas com sucesso.');
    } catch (cause) {
      console.error('Falha ao salvar configurações da conta:', cause);
      setError('Não foi possível salvar. Confira sua conexão e tente novamente.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <main className="mx-auto max-w-2xl p-6"><p>Carregando configurações…</p></main>;
  if (!uid || uid !== perfilUid) {
    return (
      <main className="mx-auto max-w-2xl space-y-4 p-6">
        <h1 className="text-2xl font-bold">Configurações do perfil</h1>
        <p className="rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Entre na sua conta para acessar as configurações do seu perfil.</p>
        <Link className="inline-block rounded bg-purple-700 px-4 py-2 text-white" href="/login">Ir para o login</Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6">
      <Link href={`/perfil/${perfilUid}`} className="text-sm font-medium text-purple-700 hover:underline">← Voltar ao perfil</Link>
      <header>
        <h1 className="text-2xl font-bold">Configurações do perfil</h1>
        <p className="mt-1 text-sm text-slate-600">Escolha como seu perfil aparece e quais avisos você quer receber.</p>
      </header>

      <form onSubmit={salvar} className="space-y-5 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <section className="space-y-2">
          <label htmlFor="nome-perfil" className="block font-semibold">Nome de exibição</label>
          <p className="text-sm text-slate-600">Esse nome aparece no seu perfil e nas atividades da liga. Seu e-mail não é exibido no perfil.</p>
          <input
            id="nome-perfil"
            value={nome}
            onChange={(event) => setNome(event.target.value)}
            maxLength={40}
            minLength={2}
            required
            autoComplete="nickname"
            className="w-full rounded border border-slate-300 px-3 py-2"
            placeholder="Como as pessoas vão chamar você"
          />
          <p className="text-right text-xs text-slate-500">{nome.length}/40 caracteres</p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h2 className="font-semibold">Notificações no site</h2>
          <label className="mt-3 flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-purple-700"
              checked={notificationsEnabled}
              onChange={(event) => setNotificationsEnabled(event.target.checked)}
            />
            <span className="text-sm">
              <span className="font-medium">Quero receber notificações</span>
              <span className="mt-1 block text-slate-600">Avisos sobre novas batalhas ou disputas, desafios recebidos e confirmação de insígnias. Você pode mudar essa escolha quando quiser.</span>
            </span>
          </label>
        </section>

        <section className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-950">
          <h2 className="font-semibold">Sua conta</h2>
          <p className="mt-1">O e-mail e os dados de acesso são protegidos e não aparecem no perfil público. Para alterar a senha, use a opção de recuperação na tela de login.</p>
          <Link href="/login" className="mt-2 inline-block font-medium text-blue-800 underline">Acessar recuperação de senha</Link>
        </section>

        {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {notice && <p role="status" className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
        <button type="submit" disabled={saving} className="w-full rounded bg-purple-700 px-4 py-3 font-semibold text-white hover:bg-purple-800 disabled:cursor-wait disabled:opacity-60 sm:w-auto">
          {saving ? 'Salvando…' : 'Salvar configurações'}
        </button>
      </form>
    </main>
  );
}
