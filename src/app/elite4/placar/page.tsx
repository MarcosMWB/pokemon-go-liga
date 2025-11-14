// src/app/elite4/placar/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  getDocs,
  doc,
  getDoc,
} from 'firebase/firestore';

type Liga = { id: string; nome: string };

type Campeonato = {
  id: string;
  liga: string;
  status: 'aberto' | 'fechado';
  createdAt: number;
};

type ParticipanteRow = {
  id: string; // id do doc em campeonatos_elite4_participantes
  usuario_uid: string;
  nome: string;
  ginasio_id: string;
  ginasio_nome: string;
  pontos: number;
};

type Elite4Slot = {
  id: string;
  pos: 1 | 2 | 3 | 4;
  uid: string;
};

export default function Elite4PlacarPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const ligaParam = searchParams.get('liga') || '';

  const [ligas, setLigas] = useState<Liga[]>([]);
  const [ligaSel, setLigaSel] = useState<string>(ligaParam);

  const [erro, setErro] = useState<string>('');
  const [loadingBase, setLoadingBase] = useState(true);

  const [campeonato, setCampeonato] = useState<Campeonato | null>(null);
  const [participantes, setParticipantes] = useState<ParticipanteRow[]>([]);
  const [elite4, setElite4] = useState<Record<number, Elite4Slot | undefined>>({});

  // Carregar ligas
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'ligas'));
        if (cancelled) return;
        const list: Liga[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return { id: d.id, nome: data.nome || d.id };
        });
        setLigas(list);
        // Se não veio liga pela URL, usa a primeira
        if (!ligaParam && list[0]?.nome) {
          setLigaSel(list[0].nome);
          // atualiza a URL para ter ?liga=
          const url = new URL(window.location.href);
          url.searchParams.set('liga', list[0].nome);
          router.replace(url.pathname + '?' + url.searchParams.toString());
        } else if (ligaParam) {
          setLigaSel(ligaParam);
        }
      } catch (e: any) {
        setErro(e.message || 'Erro ao carregar ligas.');
      } finally {
        setLoadingBase(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escutar Elite 4 atual da liga
  useEffect(() => {
    if (!ligaSel) return;
    const qElite = query(collection(db, 'elite4'), where('liga', '==', ligaSel));
    const unsub = onSnapshot(
      qElite,
      (snap) => {
        const map: Record<number, Elite4Slot | undefined> = {};
        snap.forEach((dd) => {
          const d = dd.data() as any;
          if (d.pos >= 1 && d.pos <= 4) {
            map[d.pos] = { id: dd.id, pos: d.pos, uid: d.uid };
          }
        });
        setElite4(map);
      },
      (err) => setErro(err.message || 'Erro ao escutar Elite 4.')
    );
    return () => unsub();
  }, [ligaSel]);

  // Escutar campeonato ABERTO da liga selecionada
  useEffect(() => {
    if (!ligaSel) return;
    setErro('');
    setCampeonato(null);
    setParticipantes([]);

    const qCamp = query(
      collection(db, 'campeonatos_elite4'),
      where('liga', '==', ligaSel),
      where('status', '==', 'aberto'),
      orderBy('createdAt', 'desc'),
      limit(1)
    );

    const unsubCamp = onSnapshot(
      qCamp,
      async (snap) => {
        if (snap.empty) {
          setCampeonato(null);
          setParticipantes([]);
          return;
        }
        const cDoc = snap.docs[0];
        const d = cDoc.data() as any;
        const camp: Campeonato = {
          id: cDoc.id,
          liga: d.liga,
          status: d.status,
          createdAt: d.createdAt,
        };
        setCampeonato(camp);
      },
      (err) => setErro(err.message || 'Erro ao escutar campeonato.')
    );

    return () => {
      unsubCamp();
    };
  }, [ligaSel]);

  // Escutar participantes do campeonato aberto
  useEffect(() => {
    if (!campeonato) {
      setParticipantes([]);
      return;
    }
    const qPart = query(
      collection(db, 'campeonatos_elite4_participantes'),
      where('campeonato_id', '==', campeonato.id)
    );

    const unsub = onSnapshot(
      qPart,
      async (snap) => {
        // Enriquecer com nome do usuário e do ginásio
        const rows: ParticipanteRow[] = await Promise.all(
          snap.docs.map(async (dd) => {
            const x = dd.data() as any;
            const usuario_uid = x.usuario_uid as string;
            const ginasio_id = x.ginasio_id as string;
            const pontos = Number(x.pontos ?? 0);

            // usuário
            let nome = usuario_uid;
            try {
              const u = await getDoc(doc(db, 'usuarios', usuario_uid));
              if (u.exists()) {
                const ud = u.data() as any;
                nome = ud.nome || ud.email || usuario_uid;
              }
            } catch {
              // ignora
            }

            // ginásio
            let ginasio_nome = ginasio_id;
            try {
              const g = await getDoc(doc(db, 'ginasios', ginasio_id));
              if (g.exists()) {
                const gd = g.data() as any;
                ginasio_nome = gd.nome || ginasio_id;
              }
            } catch {
              // ignora
            }

            return {
              id: dd.id,
              usuario_uid,
              nome,
              ginasio_id,
              ginasio_nome,
              pontos,
            };
          })
        );

        setParticipantes(rows);
      },
      (err) => setErro(err.message || 'Erro ao escutar participantes.')
    );

    return () => unsub();
  }, [campeonato]);

  const ranking = useMemo(() => {
    return [...participantes].sort((a, b) => (b.pontos ?? 0) - (a.pontos ?? 0));
  }, [participantes]);

  if (loadingBase) return <p className="p-6">Carregando…</p>;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Placar — Campeonato / ELITE 4</h1>
          <p className="text-sm text-gray-600">
            Liga atual: <span className="font-medium">{ligaSel || '—'}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Liga</label>
          <select
            value={ligaSel}
            onChange={(e) => {
              const v = e.target.value;
              setLigaSel(v);
              const url = new URL(window.location.href);
              url.searchParams.set('liga', v);
              router.replace(url.pathname + '?' + url.searchParams.toString());
            }}
            className="border rounded px-2 py-1 text-sm"
          >
            {ligas.map((l) => (
              <option key={l.id} value={l.nome}>
                {l.nome}
              </option>
            ))}
          </select>

          <Link
            href={`/elite4/inscricao?liga=${encodeURIComponent(ligaSel || '')}`}
            className="ml-2 bg-purple-700 text-white px-3 py-2 rounded text-sm"
          >
            Ir para inscrição
          </Link>
        </div>
      </div>

      {erro && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {erro}
        </div>
      )}

      {/* Elite 4 atual */}
      <div className="bg-white p-4 rounded shadow">
        <h2 className="text-lg font-semibold mb-2">ELITE 4 atual — {ligaSel || '—'}</h2>
        <ol className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {[1, 2, 3, 4].map((pos) => (
            <li
              key={pos}
              className={`p-3 rounded flex justify-between items-center ${
                elite4[pos]?.uid ? 'bg-gray-50' : 'bg-gray-100'
              }`}
            >
              <span className="text-sm">Posição {pos}</span>
              <span className="text-sm font-medium">
                {elite4[pos]?.uid ? elite4[pos]!.uid : '—'}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* Placar / Tabela de pontos */}
      <div className="bg-white p-4 rounded shadow">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">Tabela de Pontos</h2>
          {campeonato ? (
            <span
              className={`text-xs px-2 py-1 rounded ${
                campeonato.status === 'aberto'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-gray-100 text-gray-700'
              }`}
            >
              {campeonato.status === 'aberto' ? 'Em andamento' : 'Encerrado'}
            </span>
          ) : (
            <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded">
              Nenhum campeonato aberto
            </span>
          )}
        </div>

        {ranking.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum participante encontrado.</p>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-3 w-12">#</th>
                  <th className="py-2 pr-3">Treinador</th>
                  <th className="py-2 pr-3">Ginásio</th>
                  <th className="py-2 pr-3 w-24 text-right">Pontos</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((p, i) => {
                  const isTop4 = i < 4;
                  return (
                    <tr
                      key={p.id}
                      className={`border-b ${
                        isTop4 ? 'bg-purple-50' : ''
                      } hover:bg-gray-50 transition`}
                    >
                      <td className="py-2 pr-3 font-medium">{i + 1}</td>
                      <td className="py-2 pr-3">
                        <span className={isTop4 ? 'font-semibold text-purple-800' : ''}>
                          {p.nome}
                        </span>
                        {isTop4 && (
                          <span className="ml-2 text-[10px] bg-purple-200 text-purple-900 px-1.5 py-0.5 rounded">
                            TOP-4
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3">{p.ginasio_nome}</td>
                      <td className="py-2 pr-3 text-right font-semibold">{p.pontos}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Acesso rápido */}
      <div className="flex gap-2">
        <Link
          href={`/elite4/inscricao?liga=${encodeURIComponent(ligaSel || '')}`}
          className="bg-purple-700 text-white px-3 py-2 rounded text-sm"
        >
          Inscrever / Ver minha participação
        </Link>
        <Link href="/jogadores" className="bg-gray-200 text-gray-800 px-3 py-2 rounded text-sm">
          Jogadores
        </Link>
      </div>
    </div>
  );
}