'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { auth, db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  query,
  where,
  onSnapshot,
  orderBy,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import type { Unsubscribe } from 'firebase/firestore';
import { TYPE_ICONS } from '@/utils/typeIcons';

type Ginasio = {
  id: string;
  nome: string;
  tipo: string;
  lider_uid: string;
  lider_whatsapp?: string;
  em_disputa: boolean;
  insignia_icon?: string;
  liga?: string;
};

type Desafio = {
  id: string;
  ginasio_id: string;
  lider_uid: string;
  desafiante_uid: string;
  status: 'pendente' | 'concluido' | 'conflito';
  resultado_lider: 'lider' | 'desafiante' | null;
  resultado_desafiante: 'lider' | 'desafiante' | null;
  createdAt: number;
  liga?: string;
};

type Bloqueio = {
  id: string;
  ginasio_id: string;
  desafiante_uid: string;
  proximo_desafio: number;
};

type Disputa = {
  id: string;
  ginasio_id: string;
  status: 'inscricoes' | 'batalhando' | 'finalizado';
  liga?: string;
};

type Insignia = {
  id: string;
  ginasio_id: string;
  temporada_id: string;
};

type Liga = {
  id: string;
  nome: string;
};

export default function GinasiosPage() {
  const router = useRouter();
  const [userUid, setUserUid] = useState<string | null>(null);
  const [ginasios, setGinasios] = useState<Ginasio[]>([]);
  const [liderNomes, setLiderNomes] = useState<Record<string, string>>({});
  const [desafios, setDesafios] = useState<Desafio[]>([]);
  const [bloqueios, setBloqueios] = useState<Bloqueio[]>([]);
  const [disputas, setDisputas] = useState<Disputa[]>([]);
  const [participacoesDisputa, setParticipacoesDisputa] = useState<
    { disputa_id: string; usuario_uid: string }[]
  >([]);
  const [temporada, setTemporada] = useState<{ id: string; nome?: string } | null>(null);
  const [minhasInsignias, setMinhasInsignias] = useState<Insignia[]>([]);
  const [loading, setLoading] = useState(true);

  const [ligas, setLigas] = useState<Liga[]>([]);
  const [selectedLiga, setSelectedLiga] = useState<string>('Great');

  // CHAT do desafio
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDesafioId, setChatDesafioId] = useState<string | null>(null);
  const [chatMsgs, setChatMsgs] = useState<{ id: string; from: string; text: string; createdAt: any }[]>(
    []
  );
  const [chatInput, setChatInput] = useState('');
  const [chatOtherName, setChatOtherName] = useState('Treinador');
  const [chatOtherFC, setChatOtherFC] = useState<string | null>(null);
  const [souLiderNoChat, setSouLiderNoChat] = useState(false);
  const chatUnsubRef = useRef<Unsubscribe | null>(null);
  const desafioUnsubRef = useRef<Unsubscribe | null>(null);
  const isAndroid =
    typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '');
  const qrSrc = (data: string) =>
    `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(data)}`;
  const buildPoGoFriendLinks = (fc: string) => {
    const native = `pokemongo://?dl_action=AddFriend&DlId=${encodeURIComponent(fc)}`;
    const androidIntent = `intent://?dl_action=AddFriend&DlId=${encodeURIComponent(
      fc
    )}#Intent;scheme=pokemongo;package=com.nianticlabs.pokemongo;end`;
    return { native, androidIntent };
  };

  // 1) auth
  useEffect(() => {
    const unsub = auth.onAuthStateChanged((user) => {
      if (!user) {
        router.replace('/login');
        return;
      }
      setUserUid(user.uid);
    });
    return () => unsub();
  }, [router]);

  // 2) temporada ativa
  useEffect(() => {
    (async () => {
      const qTemp = query(collection(db, 'temporadas'), where('ativa', '==', true));
      const snap = await getDocs(qTemp);
      if (!snap.empty) {
        const d = snap.docs[0];
        const data = d.data() as any;
        setTemporada({ id: d.id, nome: data.nome });
      } else {
        setTemporada(null);
      }
    })();
  }, []);

  // 2.1) ligas
  useEffect(() => {
    (async () => {
      const snap = await getDocs(collection(db, 'ligas'));
      const list: Liga[] = snap.docs.map((d) => ({
        id: d.id,
        nome: (d.data() as any).nome,
      }));
      setLigas(list);
      if (list.length > 0) setSelectedLiga(list[0].nome);
    })();
  }, []);

  // 3) ginasios em tempo real
  useEffect(() => {
    const colRef = collection(db, 'ginasios');
    const unsub = onSnapshot(colRef, (snap) => {
      const list: Ginasio[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          nome: data.nome,
          tipo: data.tipo || '',
          liga: data.liga || '',
          lider_uid: data.lider_uid || '',
          lider_whatsapp: data.lider_whatsapp || '',
          em_disputa: data.em_disputa || false,
          insignia_icon: data.insignia_icon || '',
        };
      });
      setGinasios(list);
      setLoading(false);
    });

    return () => unsub();
  }, []);

  // 4) disputas em tempo real
  useEffect(() => {
    const qDisputas = query(
      collection(db, 'disputas_ginasio'),
      where('status', 'in', ['inscricoes', 'batalhando'])
    );
    const unsub = onSnapshot(qDisputas, (snap) => {
      const list: Disputa[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          ginasio_id: data.ginasio_id,
          status: data.status,
          liga: data.liga || '',
        };
      });
      setDisputas(list);
    });
    return () => unsub();
  }, []);

  // 5) nomes dos líderes
  useEffect(() => {
    async function loadLideres() {
      const nomes: Record<string, string> = {};
      for (const g of ginasios) {
        if (!g.lider_uid) continue;
        const u = await getDoc(doc(db, 'usuarios', g.lider_uid));
        if (u.exists()) {
          const ud = u.data() as any;
          nomes[g.lider_uid] = ud.nome || ud.email || g.lider_uid;
        } else {
          nomes[g.lider_uid] = g.lider_uid;
        }
      }
      setLiderNomes(nomes);
    }
    if (ginasios.length) {
      loadLideres();
    }
  }, [ginasios]);

  // 6) desafios do usuário (como desafiante e como líder)
  useEffect(() => {
    if (!userUid) return;

    const qDesafiante = query(
      collection(db, 'desafios_ginasio'),
      where('desafiante_uid', '==', userUid)
    );
    const unsub1 = onSnapshot(qDesafiante, (snap) => {
      setDesafios((prev) => {
        const outros = prev.filter((d) => d.desafiante_uid !== userUid);
        const meus = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            ginasio_id: data.ginasio_id,
            liga: data.liga || '',
            lider_uid: data.lider_uid,
            desafiante_uid: data.desafiante_uid,
            status: data.status,
            resultado_lider: data.resultado_lider ?? null,
            resultado_desafiante: data.resultado_desafiante ?? null,
            createdAt: data.createdAt,
          } as Desafio;
        });
        return [...outros, ...meus];
      });
    });

    const qLider = query(collection(db, 'desafios_ginasio'), where('lider_uid', '==', userUid));
    const unsub2 = onSnapshot(qLider, (snap) => {
      setDesafios((prev) => {
        const outros = prev.filter((d) => d.lider_uid !== userUid);
        const meus = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            ginasio_id: data.ginasio_id,
            liga: data.liga || '',
            lider_uid: data.lider_uid,
            desafiante_uid: data.desafiante_uid,
            status: data.status,
            resultado_lider: data.resultado_lider ?? null,
            resultado_desafiante: data.resultado_desafiante ?? null,
            createdAt: data.createdAt,
          } as Desafio;
        });
        return [...outros, ...meus];
      });
    });

    return () => {
      unsub1();
      unsub2();
    };
  }, [userUid]);

  // 7) bloqueios do usuário
  useEffect(() => {
    if (!userUid) return;
    const qBloq = query(
      collection(db, 'bloqueios_ginasio'),
      where('desafiante_uid', '==', userUid)
    );
    const unsub = onSnapshot(qBloq, (snap) => {
      const list: Bloqueio[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          ginasio_id: data.ginasio_id,
          desafiante_uid: data.desafiante_uid,
          proximo_desafio: data.proximo_desafio,
        };
      });
      setBloqueios(list);
    });
    return () => unsub();
  }, [userUid]);

  // 8) minhas inscrições nas disputas
  useEffect(() => {
    if (!userUid) return;
    const qPart = query(
      collection(db, 'disputas_ginasio_participantes'),
      where('usuario_uid', '==', userUid)
    );
    const unsub = onSnapshot(qPart, (snap) => {
      const list = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          disputa_id: data.disputa_id as string,
          usuario_uid: data.usuario_uid as string,
        };
      });
      setParticipacoesDisputa(list);
    });
    return () => unsub();
  }, [userUid]);

  // 9) minhas insígnias
  useEffect(() => {
    if (!userUid) return;
    const qIns = query(collection(db, 'insignias'), where('usuario_uid', '==', userUid));
    const unsub = onSnapshot(qIns, (snap) => {
      const list: Insignia[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          ginasio_id: data.ginasio_id,
          temporada_id: data.temporada_id || '',
        };
      });
      setMinhasInsignias(list);
    });
    return () => unsub();
  }, [userUid]);

  const handleDesafiar = async (g: Ginasio) => {
    if (!userUid) return;
    if (!g.lider_uid) return;

    const jaTem = minhasInsignias.some((i) => {
      if (i.ginasio_id !== g.id) return false;
      if (temporada?.id) {
        return i.temporada_id === temporada.id;
      }
      return false;
    });
    if (jaTem) {
      alert('Você já conquistou este ginásio nesta temporada.');
      return;
    }

    const pendente = desafios.find(
      (d) =>
        d.ginasio_id === g.id &&
        d.desafiante_uid === userUid &&
        d.status === 'pendente'
    );
    if (pendente) return;

    await addDoc(collection(db, 'desafios_ginasio'), {
      ginasio_id: g.id,
      liga: g.liga || selectedLiga || '',
      lider_uid: g.lider_uid,
      desafiante_uid: userUid,
      status: 'pendente',
      resultado_lider: null,
      resultado_desafiante: null,
      createdAt: Date.now(),
    });
  };

  const handleEntrarDisputa = async (g: Ginasio, disputa: Disputa) => {
    if (!userUid) return;

    const ja = participacoesDisputa.find(
      (p) => p.disputa_id === disputa.id && p.usuario_uid === userUid
    );
    if (ja) return;

    await addDoc(collection(db, 'disputas_ginasio_participantes'), {
      disputa_id: disputa.id,
      ginasio_id: g.id,
      usuario_uid: userUid,
      tipo_escolhido: '',
      liga: g.liga || selectedLiga || '',
      createdAt: Date.now(),
    });
  };

  // CHAT handlers
  async function openDesafioChat(desafioId: string) {
    if (!userUid) return;
    chatUnsubRef.current?.();
    desafioUnsubRef.current?.();

    setChatOpen(true);
    setChatDesafioId(desafioId);
    setChatMsgs([]);
    setChatInput('');

    const dSnap = await getDoc(doc(db, 'desafios_ginasio', desafioId));
    if (dSnap.exists()) {
      const d = dSnap.data() as any;
      const otherUid = d.lider_uid === userUid ? d.desafiante_uid : d.lider_uid;
      setSouLiderNoChat(d.lider_uid === userUid);

      let nome = 'Treinador';
      let fc: string | null = null;
      const uSnap = await getDoc(doc(db, 'usuarios', otherUid));
      if (uSnap.exists()) {
        const ud = uSnap.data() as any;
        nome = ud.nome || ud.email || nome;
        fc = ud.friend_code || null;
      }
      setChatOtherName(nome);
      setChatOtherFC(fc);
    }

    const msgsQ = query(
      collection(db, 'desafios_ginasio', desafioId, 'mensagens'),
      orderBy('createdAt', 'asc')
    );
    chatUnsubRef.current = onSnapshot(msgsQ, (snap) => {
      setChatMsgs(
        snap.docs.map((d) => {
          const x = d.data() as any;
          return { id: d.id, from: x.from, text: x.text, createdAt: x.createdAt };
        })
      );
    });

    desafioUnsubRef.current = onSnapshot(doc(db, 'desafios_ginasio', desafioId), async (ds) => {
      if (!ds.exists()) return;
      const dd = ds.data() as any;
      if (dd.status === 'concluido' || dd.status === 'conflito') {
        await clearDesafioChat(desafioId);
        closeDesafioChat();
      }
    });
  }

  function closeDesafioChat() {
    chatUnsubRef.current?.();
    desafioUnsubRef.current?.();
    setChatOpen(false);
    setChatDesafioId(null);
    setChatMsgs([]);
    setChatInput('');
    setChatOtherFC(null);
  }

  async function sendChatMessage() {
    if (!userUid || !chatDesafioId || !chatInput.trim()) return;
    await addDoc(collection(db, 'desafios_ginasio', chatDesafioId, 'mensagens'), {
      from: userUid,
      text: chatInput.trim(),
      createdAt: serverTimestamp(),
    });
    setChatInput('');
  }

  async function declareResultadoVenci() {
    await declareResultado(souLiderNoChat ? 'lider' : 'desafiante');
  }
  async function declareResultadoFuiDerrotado() {
    await declareResultado(souLiderNoChat ? 'desafiante' : 'lider');
  }

  async function declareResultado(vencedor: 'lider' | 'desafiante') {
    if (!userUid || !chatDesafioId) return;
    const ref = doc(db, 'desafios_ginasio', chatDesafioId);
    const dSnap = await getDoc(ref);
    if (!dSnap.exists()) return;
    const d = dSnap.data() as any;

    const souLider = d.lider_uid === userUid;
    const campo = souLider ? 'resultado_lider' : 'resultado_desafiante';
    await updateDoc(ref, { [campo]: vencedor });

    await tentarFinalizarDesafio(ref);
  }

  async function tentarFinalizarDesafio(ref: any) {
    const dSnap = await getDoc(ref);
    const d = dSnap.data() as any;
    const rl = d.resultado_lider;
    const rd = d.resultado_desafiante;
    if (!rl || !rd) return;

    const gRef = doc(db, 'ginasios', d.ginasio_id);
    const gSnap = await getDoc(gRef);
    const gData = gSnap.exists() ? (gSnap.data() as any) : null;

    if (rl === rd) {
      if (rl === 'desafiante') {
        await addDoc(collection(db, 'insignias'), {
          usuario_uid: d.desafiante_uid,
          ginasio_id: d.ginasio_id,
          ginasio_nome: gData?.nome || '',
          ginasio_tipo: gData?.tipo || '',
          insignia_icon: gData?.insignia_icon || '',
          temporada_id: temporada?.id || '',
          temporada_nome: temporada?.nome || '',
          liga: gData?.liga || d.liga || '',
          createdAt: Date.now(),
        });

        await addDoc(collection(db, 'bloqueios_ginasio'), {
          ginasio_id: d.ginasio_id,
          desafiante_uid: d.desafiante_uid,
          proximo_desafio: Date.now() + 7 * 24 * 60 * 60 * 1000,
        });

        if (gSnap.exists()) {
          let derrotas = gData?.derrotas_seguidas ?? 0;
          derrotas += 1;
          if (derrotas >= 3) {
            await addDoc(collection(db, 'disputas_ginasio'), {
              ginasio_id: d.ginasio_id,
              status: 'inscricoes',
              liga: gData?.liga || d.liga || '',
              tipo_original: gData?.tipo || '',
              lider_anterior_uid: gData?.lider_uid || '',
              temporada_id: temporada?.id || '',
              temporada_nome: temporada?.nome || '',
              createdAt: Date.now(),
            });
            await updateDoc(gRef, { lider_uid: '', em_disputa: true, derrotas_seguidas: 0 });
          } else {
            await updateDoc(gRef, { derrotas_seguidas: derrotas });
          }
        }
      } else {
        await updateDoc(gRef, { derrotas_seguidas: 0 });
        await addDoc(collection(db, 'bloqueios_ginasio'), {
          ginasio_id: d.ginasio_id,
          desafiante_uid: d.desafiante_uid,
          proximo_desafio: Date.now() + 15 * 24 * 60 * 60 * 1000, // 15 dias
        });
      }

      await updateDoc(ref, { status: 'concluido' });
      await clearDesafioChat(ref.id);
      closeDesafioChat();
    } else {
      await updateDoc(ref, { status: 'conflito' });
      await addDoc(collection(db, 'alertas_conflito'), {
        desafio_id: ref.id,
        ginasio_id: d.ginasio_id,
        lider_uid: d.lider_uid,
        desafiante_uid: d.desafiante_uid,
        createdAt: Date.now(),
      });
      await clearDesafioChat(ref.id);
      closeDesafioChat();
    }
  }

  async function clearDesafioChat(desafioId: string) {
    const snap = await getDocs(collection(db, 'desafios_ginasio', desafioId, 'mensagens'));
    await Promise.all(
      snap.docs.map((m) =>
        deleteDoc(doc(db, 'desafios_ginasio', desafioId, 'mensagens', m.id))
      )
    );
  }

  const agora = Date.now();

  if (loading) return <p className="p-8">Carregando...</p>;

  const ginasiosFiltrados =
    selectedLiga && selectedLiga !== ''
      ? ginasios.filter((g) => (g.liga || '') === selectedLiga)
      : ginasios;

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between mb-4 gap-2">
        <h1 className="text-2xl font-bold">Ginásios</h1>
        {ligas.length > 0 && (
          <select
            value={selectedLiga}
            onChange={(e) => setSelectedLiga(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          >
            {ligas.map((l) => (
              <option key={l.id} value={l.nome}>
                {l.nome}
              </option>
            ))}
          </select>
        )}
      </div>

      {ginasiosFiltrados.map((g) => {
        const meuDesafio = desafios.find(
          (d) =>
            d.ginasio_id === g.id &&
            (d.desafiante_uid === userUid || d.lider_uid === userUid) &&
            d.status === 'pendente'
        );

        const meuBloqueio = bloqueios.find(
          (b) => b.ginasio_id === g.id && b.desafiante_uid === userUid
        );
        const bloqueado = meuBloqueio ? meuBloqueio.proximo_desafio > agora : false;

        const disputaDoGinasio = disputas.find(
          (d) => d.ginasio_id === g.id && d.status === 'inscricoes'
        );

        const jaNaDisputa = disputaDoGinasio
          ? participacoesDisputa.some((p) => p.disputa_id === disputaDoGinasio.id)
          : false;

        const semLider = !g.lider_uid;

        const jaTemInsignia = minhasInsignias.some((i) => {
          if (i.ginasio_id !== g.id) return false;
          if (temporada?.id) return i.temporada_id === temporada.id;
          return false;
        });

        return (
          <div
            key={g.id}
            className="bg-white border rounded p-4 flex justify-between items-center"
          >
            <div>
              <h2 className="text-lg font-semibold">
                {g.nome}{' '}
                {g.em_disputa && (
                  <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded ml-2">
                    em disputa
                  </span>
                )}
              </h2>
              {g.liga && <p className="text-xs text-gray-400 mb-1">Liga: {g.liga}</p>}
              <p className="text-sm text-gray-600 flex items-center gap-2">
                Tipo:
                {g.tipo ? (
                  <>
                    {TYPE_ICONS[g.tipo] && (
                      <Image src={TYPE_ICONS[g.tipo]} alt={g.tipo} width={20} height={20} />
                    )}
                    <span>{g.tipo}</span>
                  </>
                ) : (
                  <span>não definido</span>
                )}
              </p>
              <p className="text-sm text-gray-600">
                Líder: {g.lider_uid ? liderNomes[g.lider_uid] || g.lider_uid : 'vago'}
              </p>
            </div>

            <div className="flex flex-col gap-2 items-end">
              {disputaDoGinasio ? (
                <>
                  {jaNaDisputa ? (
                    <span className="text-xs text-gray-500">Você já está na disputa</span>
                  ) : (
                    <button
                      onClick={() => handleEntrarDisputa(g, disputaDoGinasio)}
                      className="px-3 py-1 bg-purple-500 text-white rounded text-sm"
                    >
                      Entrar na disputa
                    </button>
                  )}
                  <Link
                    href={`/ginasios/${g.id}/disputa`}
                    className="text-xs text-blue-600 underline"
                  >
                    Ver disputa
                  </Link>
                </>
              ) : meuDesafio && meuDesafio.status === 'pendente' ? (
                <div className="flex flex-col gap-2 items-end">
                  <button
                    onClick={() => openDesafioChat(meuDesafio.id)}
                    className="px-3 py-1 bg-slate-800 text-white rounded text-sm"
                  >
                    Abrir chat do desafio
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => handleDesafiar(g)}
                  disabled={bloqueado || semLider || jaTemInsignia || g.lider_uid === userUid}
                  className="px-3 py-1 bg-yellow-500 text-white rounded text-sm disabled:opacity-50"
                >
                  {g.lider_uid === userUid
                    ? 'Você é o líder'
                    : semLider
                    ? 'Sem líder'
                    : jaTemInsignia
                    ? 'Já ganhou'
                    : 'Desafiar'}
                </button>
              )}
            </div>
          </div>
        );
      })}

      {chatOpen && chatDesafioId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={closeDesafioChat} />
          <div className="relative bg-white w-full max-w-2xl rounded-xl shadow-xl p-4 md:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Desafio & Chat</h3>
                <p className="text-sm text-slate-600">Converse e finalize o resultado.</p>
              </div>
              <button
                className="text-slate-500 hover:text-slate-800 text-sm"
                onClick={closeDesafioChat}
              >
                Fechar
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border rounded-lg p-3">
                <p className="text-xs text-slate-500">Adicionar {chatOtherName}:</p>
                {chatOtherFC ? (
                  <>
                    <p className="text-sm font-semibold">FC: {chatOtherFC}</p>
                    {(() => {
                      const { native, androidIntent } = buildPoGoFriendLinks(chatOtherFC!);
                      const deep = isAndroid ? androidIntent : native;
                      return (
                        <div className="mt-2 flex flex-col items-start gap-2">
                          <a href={deep} className="text-blue-600 text-sm hover:underline">
                            Abrir no Pokémon GO
                          </a>
                          <img
                            src={qrSrc(native)}
                            alt="QR para adicionar"
                            className="w-40 h-40 border rounded"
                          />
                          <button
                            onClick={() => navigator.clipboard?.writeText(chatOtherFC!)}
                            className="text-xs bg-slate-200 hover:bg-slate-300 px-2 py-1 rounded"
                          >
                            Copiar FC
                          </button>
                        </div>
                      );
                    })()}
                  </>
                ) : (
                  <p className="text-xs text-amber-600">O outro jogador não cadastrou FC.</p>
                )}
              </div>
            </div>

            <div className="mt-4 border rounded-lg p-3 max-h-72 overflow-auto bg-slate-50">
              {chatMsgs.length === 0 ? (
                <p className="text-xs text-slate-500">Nenhuma mensagem ainda.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {chatMsgs.map((m) => {
                    const mine = m.from === userUid;
                    return (
                      <div
                        key={m.id}
                        className={`max-w-[85%] px-3 py-2 rounded ${
                          mine ? 'self-end bg-blue-600 text-white' : 'self-start bg-white border'
                        }`}
                      >
                        <p className="text-xs">{m.text}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-3 flex items-center gap-2">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendChatMessage()}
                className="flex-1 border rounded px-3 py-2 text-sm"
                placeholder="Escreva uma mensagem..."
              />
              <button
                onClick={sendChatMessage}
                className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded"
              >
                Enviar
              </button>
              <button
                onClick={declareResultadoVenci}
                className="bg-green-600 hover:bg-green-700 text-white text-sm px-3 py-2 rounded"
                title="Você declara que VENCEU"
              >
                Venci
              </button>
              <button
                onClick={declareResultadoFuiDerrotado}
                className="bg-red-600 hover:bg-red-700 text-white text-sm px-3 py-2 rounded"
                title="Você declara que FOI DERROTADO"
              >
                Fui derrotado
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
