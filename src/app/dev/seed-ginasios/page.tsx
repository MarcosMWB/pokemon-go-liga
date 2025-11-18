'use client';

import { useEffect, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { User } from 'firebase/auth';

type Liga = { id: string; nome: string };

export default function SeedGinasiosUI() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [ligas, setLigas] = useState<Liga[]>([]);
  const [ligaSelecionada, setLigaSelecionada] = useState('');
  const [msg, setMsg] = useState('');

  // checa superuser pelo client
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user: User | null) => {
      if (!user) {
        setIsAdmin(false);
        return;
      }
      const snap = await getDocs(collection(db, 'superusers'));
      // se existir doc com id == uid, é admin
      const is = snap.docs.some((d) => d.id === user.uid);
      setIsAdmin(is);
    });
    return () => unsub();
  }, []);

  // carrega ligas
  useEffect(() => {
    if (isAdmin !== true) return;
    (async () => {
      const snap = await getDocs(collection(db, 'ligas'));
      const list = snap.docs.map((d) => ({
        id: d.id,
        nome: (d.data() as any).nome || d.id,
      }));
      setLigas(list);
      if (list.length > 0) setLigaSelecionada(list[0].nome);
    })();
  }, [isAdmin]);

  async function handleSeed() {
    if (!ligaSelecionada) {
      setMsg('Escolha uma liga.');
      return;
    }
    setMsg('Enviando...');
    const r = await fetch('/api/seed-ginasios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ liga: ligaSelecionada }),
    });
    const j = await r.json();
    if (j?.ok) setMsg('Pronto!');
    else setMsg('Erro: ' + (j?.error || 'falhou'));
  }

  if (isAdmin === null) return <div className="p-6">Carregando…</div>;
  if (!isAdmin) return <div className="p-6 text-sm text-red-600">Sem acesso.</div>;

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-bold">Semear ginásios</h1>

      <div className="flex items-center gap-2">
        <label className="text-sm">Liga:</label>
        <select
          value={ligaSelecionada}
          onChange={(e) => setLigaSelecionada(e.target.value)}
          className="border rounded px-2 py-1 text-sm"
        >
          {ligas.map((l) => (
            <option key={l.id} value={l.nome}>
              {l.nome}
            </option>
          ))}
        </select>
      </div>

      <button
        onClick={handleSeed}
        className="bg-blue-600 text-white px-4 py-2 rounded text-sm"
      >
        Criar 10 ginásios
      </button>

      {msg && <p className="text-sm">{msg}</p>}
    </div>
  );
}
