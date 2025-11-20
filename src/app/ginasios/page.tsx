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
  Unsubscribe,
} from 'firebase/firestore';
import { TYPE_ICONS } from '@/utils/typeIcons';
import { User } from 'firebase/auth';

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
  disputa_id?: string | null;
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

type Liga = { id: string; nome: string };

/* ---------- Helpers para slug e sprite de Pokémon ---------- */

function slugifyBase(displayBase: string) {
  return displayBase
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.’'"]/g, '')
    .replace(/\./g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
}

function suffixToToken(suf: string) {
  const s = suf.trim().toLowerCase();
  if (s === 'alola') return 'alola';
  if (s === 'galar') return 'galar';
  if (s === 'hisui') return 'hisui';
  if (s === 'paldea') return 'paldea';
  if (s === 'hero') return 'hero';
  if (s === 'male') return 'male';
  if (s === 'female') return 'female';
  if (s === 'paldea combat') return 'paldea-combat-breed';
  if (s === 'paldea blaze') return 'paldea-blaze-breed';
  if (s === 'paldea aqua') return 'paldea-aqua-breed';
  return s.replace(/\s+/g, '-');
}

function displayNameToSlug(displayName: string): string {
  const m = displayName.match(/^(.*)\((.+)\)\s*$/);
  if (m) {
    const base = slugifyBase(m[1]);
    const token = suffixToToken(m[2]);
    return `${base}-${token}`;
  }
  return slugifyBase(displayName);
}

function officialArtworkById(id: number) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
}

function PokemonMini({ displayName, size = 24 }: { displayName: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const slug = displayNameToSlug(displayName);
      try {
        const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${slug}`);
        if (!res.ok) {
          if (!cancelled) setSrc(null);
          return;
        }
        const data = await res.json();
        const id = data?.id as number | undefined;
        if (!cancelled && id) {
          setSrc(officialArtworkById(id));
        }
      } catch {
        if (!cancelled) setSrc(null);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [displayName]);

  if (!src) return <div className="w-6 h-6 rounded bg-gray-200" />;

  return (
    <Image
      src={src}
      alt={displayName}
      width={size}
      height={size}
      onError={() => setSrc(null)}
      className="rounded"
    />
  );
}

/* --------------------- Página principal --------------------- */

export default function GinasiosPage() {
  const router = useRouter();
  const [userUid, setUserUid] = useState<string | null>(null);
  const [ginasios, setGinasios] = useState<Ginasio[]>([]);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
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

  // equipe do usuário para a liga/temporada selecionadas
  const [minhaEquipeLiga, setMinhaEquipeLiga] = useState<string[]>([]);

  // cache de equipes por usuário (para mostrar equipe do desafiante)
  const [equipesPorUsuario, setEquipesPorUsuario] = useState<Record<string, string[]>>({});

  // select de desafiantes por ginásio (quando você é o líder)
  const [selectedDesafiantePorGinasio, setSelectedDesafiantePorGinasio] = useState<
    Record<string, string>
  >({});

  // CHAT
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDesafioId, setChatDesafioId] = useState<string | null>(null);
  const [chatMsgs, setChatMsgs] = useState<
    { id: string; from: string; text: string; createdAt: any }[]
  >([]);
  const [chatInput, setChatInput] = useState('');
  const [chatOtherName, setChatOtherName] = useState('Treinador');
  const [chatOtherFC, setChatOtherFC] = useState<string | null>(null);
  const [souLiderNoChat, setSouLiderNoChat] = useState(false);
  const chatUnsubRef = useRef<Unsubscribe | null>(null);
  const desafioUnsubRef = useRef<Unsubscribe | null>(null);
  const isAndroid =
    typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '');
  const qrSrc = (data: string) =>
    `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(
      data
    )}`;
  const buildPoGoFriendLinks = (fc: string) => {
    const native = `pokemongo://?dl_action=AddFriend&DlId=${encodeURIComponent(fc)}`;
    const androidIntent = `intent://?dl_action=AddFriend&DlId=${encodeURIComponent(
      fc
    )}#Intent;scheme=pokemongo;package=com.nianticlabs.pokemongo;end`;
    return { native, androidIntent };
  };

  // 1) auth
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (current: User | null) => {
      if (!current) {
        router.replace('/login');
        return;
      }
      setUserUid(current.uid);
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
        return { id: d.id, ginasio_id: data.ginasio_id, status: data.status, liga: data.liga || '' };
      });
      setDisputas(list);
    });
    return () => unsub();
  }, []);

  // 5) nomes dos usuários (líderes + desafiantes)
  useEffect(() => {
    async function loadUsers() {
      const nomes: Record<string, string> = {};
      const uids = new Set<string>();

      ginasios.forEach((g) => {
        if (g.lider_uid) uids.add(g.lider_uid);
      });

      desafios.forEach((d) => {
        if (d.lider_uid) uids.add(d.lider_uid);
        if (d.desafiante_uid) uids.add(d.desafiante_uid);
      });

      for (const uid of uids) {
        const u = await getDoc(doc(db, 'usuarios', uid));
        if (u.exists()) {
          const ud = u.data() as any;
          nomes[uid] = ud.nome || ud.email || uid;
        } else {
          nomes[uid] = uid;
        }
      }

      setUserNames(nomes);
    }

    if (ginasios.length || desafios.length) loadUsers();
  }, [ginasios, desafios]);

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
            disputa_id: data.disputa_id ?? null,
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
            disputa_id: data.disputa_id ?? null,
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
        return { disputa_id: data.disputa_id as string, usuario_uid: data.usuario_uid as string };
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

  // 10) carregar equipe do usuário para a liga/temporada selecionadas
  useEffect(() => {
    async function loadEquipe() {
      if (!userUid || !temporada || !selectedLiga) {
        setMinhaEquipeLiga([]);
        return;
      }

      try {
        const ligaSnap = await getDocs(
          query(collection(db, 'ligas'), where('nome', '==', selectedLiga))
        );
        if (ligaSnap.empty) {
          setMinhaEquipeLiga([]);
          return;
        }
        const ligaDoc = ligaSnap.docs[0];

        const partSnap = await getDocs(
          query(
            collection(db, 'participacoes'),
            where('usuario_id', '==', userUid),
            where('liga_id', '==', ligaDoc.id),
            where('temporada_id', '==', temporada.id)
          )
        );
        if (partSnap.empty) {
          setMinhaEquipeLiga([]);
          return;
        }

        const participacaoId = partSnap.docs[0].id;
        const pokSnap = await getDocs(
          query(collection(db, 'pokemon'), where('participacao_id', '==', participacaoId))
        );
        const nomes = pokSnap.docs.map((d) => (d.data() as any).nome as string);
        setMinhaEquipeLiga(nomes);

        setEquipesPorUsuario((prev) => ({ ...prev, [userUid]: nomes }));
      } catch (e) {
        console.error('Erro ao carregar equipe da liga (minha):', e);
        setMinhaEquipeLiga([]);
      }
    }

    loadEquipe();
  }, [userUid, temporada, selectedLiga]);

  // 11) carregar equipes dos desafiantes (para quando você é líder)
  useEffect(() => {
    async function loadEquipesDesafiantes() {
      if (!temporada || !selectedLiga) return;

      const uids = new Set<string>();
      desafios.forEach((d) => {
        uids.add(d.desafiante_uid);
      });

      const toFetch = Array.from(uids).filter((uid) => !equipesPorUsuario[uid]);
      if (toFetch.length === 0) return;

      try {
        const ligaSnap = await getDocs(
          query(collection(db, 'ligas'), where('nome', '==', selectedLiga))
        );
        if (ligaSnap.empty) return;
        const ligaDoc = ligaSnap.docs[0];

        const newMap: Record<string, string[]> = {};

        for (const uid of toFetch) {
          const partSnap = await getDocs(
            query(
              collection(db, 'participacoes'),
              where('usuario_id', '==', uid),
              where('liga_id', '==', ligaDoc.id),
              where('temporada_id', '==', temporada.id)
            )
          );
          if (partSnap.empty) {
            newMap[uid] = [];
            continue;
          }
          const participacaoId = partSnap.docs[0].id;
          const pokSnap = await getDocs(
            query(collection(db, 'pokemon'), where('participacao_id', '==', participacaoId))
          );
          const nomes = pokSnap.docs.map((d) => (d.data() as any).nome as string);
          newMap[uid] = nomes;
        }

        if (Object.keys(newMap).length > 0) {
          setEquipesPorUsuario((prev) => ({ ...prev, ...newMap }));
        }
      } catch (e) {
        console.error('Erro ao carregar equipe de desafiantes:', e);
      }
    }

    loadEquipesDesafiantes();
  }, [desafios, selectedLiga, temporada, equipesPorUsuario]);

  // util para encerrar período de liderança aberto
  async function encerrarLideratoSeAberto(ginasioId: string, liderUid: string) {
    try {
      const qAberto = query(
        collection(db, 'ginasios_lideratos'),
        where('ginasio_id', '==', ginasioId),
        where('lider_uid', '==', liderUid)
      );
      const snap = await getDocs(qAberto);
      const pendentes = snap.docs.filter((d) => {
        const x = d.data() as any;
        return x.fim === null || x.fim === undefined;
      });
      await Promise.all(
        pendentes.map((d) =>
          updateDoc(doc(db, 'ginasios_lideratos', d.id), { fim: Date.now() })
        )
      );
    } catch (e) {
      console.warn('Falha ao encerrar líderato aberto', e);
    }
  }

  const handleDesafiar = async (g: Ginasio) => {
    if (!userUid || !g.lider_uid) return;

    const jaTem = minhasInsignias.some(
      (i) => i.ginasio_id === g.id && (temporada?.id ? i.temporada_id === temporada.id : false)
    );
    if (jaTem) {
      alert('Você já conquistou este ginásio nesta temporada.');
      return;
    }

    const pendente = desafios.find(
      (d) =>
        d.ginasio_id === g.id &&
        d.desafiante_uid === userUid &&
        d.status === 'pendente' &&
        !d.disputa_id
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
      disputa_id: null,
    });
  };

  async function openDesafioChat(desafioId: string) {
    if (!userUid) return;

    chatUnsubRef.current?.();
    desafioUnsubRef.current?.();

    const dRef = doc(db, 'desafios_ginasio', desafioId);
    const dSnap = await getDoc(dRef);
    if (!dSnap.exists()) {
      alert('Desafio inexistente.');
      return;
    }
    const d = dSnap.data() as any;
    const souParticipante = d.lider_uid === userUid || d.desafiante_uid === userUid;
    if (!souParticipante) {
      alert('Você não participa deste desafio.');
      return;
    }

    setChatOpen(true);
    setChatDesafioId(desafioId);
    setChatMsgs([]);
    setChatInput('');

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

    const msgsQ = query(
      collection(db, 'desafios_ginasio', desafioId, 'mensagens'),
      orderBy('createdAt', 'asc')
    );
    chatUnsubRef.current = onSnapshot(
      msgsQ,
      (snap) => {
        setChatMsgs(
          snap.docs.map((d) => {
            const x = d.data() as any;
            return { id: d.id, from: x.from, text: x.text, createdAt: x.createdAt };
          })
        );
      },
      (err) => {
        console.error('Chat listener error:', err);
        alert('Sem permissão para abrir este chat.');
        closeDesafioChat();
      }
    );

    desafioUnsubRef.current = onSnapshot(
      dRef,
      async (ds) => {
        if (!ds.exists()) return;
        const dd = ds.data() as any;
        if (dd.status === 'concluido' || dd.status === 'conflito') {
          await clearDesafioChat(desafioId);
          closeDesafioChat();
        }
      },
      (err) => console.error('Desafio listener error:', err)
    );
  }

  function closeDesafioChat() {
    chatUnsubRef.current?.();
    desafioUnsubRef.current?.();
    chatUnsubRef.current = null;
    desafioUnsubRef.current = null;
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
          lider_derrotado_uid: d.lider_uid,
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
              origem: '3_derrotas',
              createdAt: Date.now(),
            });

            if (gData?.lider_uid) {
              await encerrarLideratoSeAberto(d.ginasio_id, gData.lider_uid);
            }

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
          proximo_desafio: Date.now() + 15 * 24 * 60 * 60 * 1000,
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
        <button
          onClick={() => router.push(`/tutorials`)}
          className="bg-purple-600 text-white px-3 py-2 rounded text-sm "
        >
          Ver tutorial
        </button>
      </div>

      {ginasiosFiltrados.map((g) => {
        const souLiderNoGinasio = g.lider_uid === userUid;

        // desafios pendentes (sem disputa) neste ginásio que envolvem o usuário
        const meusDesafiosPendentes = desafios.filter(
          (d) =>
            d.ginasio_id === g.id &&
            !d.disputa_id &&
            d.status === 'pendente' &&
            (d.desafiante_uid === userUid || d.lider_uid === userUid)
        );

        const desafiosPendentesComoLider = souLiderNoGinasio
          ? meusDesafiosPendentes.filter((d) => d.lider_uid === userUid)
          : [];
        const desafiosPendentesComoDesafiante = meusDesafiosPendentes.filter(
          (d) => d.desafiante_uid === userUid
        );
        const haDesafioPendente = meusDesafiosPendentes.length > 0;

        // para desafiante: sempre vai ter no máximo 1 pendente por ginásio
        const desafioComoDesafiante =
          desafiosPendentesComoDesafiante.length > 0
            ? desafiosPendentesComoDesafiante[0]
            : null;

        // para líder: lista de desafiantes com status pendente
        const desafiantesPendentesIds = Array.from(
          new Set(desafiosPendentesComoLider.map((d) => d.desafiante_uid))
        );

        const selectedDesafianteIdRaw = selectedDesafiantePorGinasio[g.id];
        const selectedDesafianteId =
          selectedDesafianteIdRaw && desafiantesPendentesIds.includes(selectedDesafianteIdRaw)
            ? selectedDesafianteIdRaw
            : desafiantesPendentesIds[0] || '';

        const desafioSelecionadoComoLider =
          desafiosPendentesComoLider.find((d) => d.desafiante_uid === selectedDesafianteId) ||
          desafiosPendentesComoLider[0] ||
          null;

        const equipeDesafianteSelecionado =
          desafioSelecionadoComoLider
            ? equipesPorUsuario[desafioSelecionadoComoLider.desafiante_uid] || []
            : [];

        const meuBloqueio = bloqueios.find(
          (b) => b.ginasio_id === g.id && b.desafiante_uid === userUid
        );
        const bloqueado = meuBloqueio ? meuBloqueio.proximo_desafio > agora : false;

        const disputaDoGinasio = disputas.find(
          (d) => d.ginasio_id === g.id && d.status === 'inscricoes'
        );
        const disputaBatalhandoGinasio = disputas.find(
          (d) => d.ginasio_id === g.id && d.status === 'batalhando'
        );

        const jaNaDisputa = disputaDoGinasio
          ? participacoesDisputa.some((p) => p.disputa_id === disputaDoGinasio.id)
          : false;

        const semLider = !g.lider_uid;

        const jaTemInsignia = minhasInsignias.some(
          (i) => i.ginasio_id === g.id && (temporada?.id ? i.temporada_id === temporada.id : false)
        );

        return (
          <div key={g.id} className="card p-4 flex justify-between items-center">
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
                      <Image
                        src={TYPE_ICONS[g.tipo]}
                        alt={g.tipo}
                        width={20}
                        height={20}
                      />
                    )}
                    <span>{g.tipo}</span>
                  </>
                ) : (
                  <span>não definido</span>
                )}
              </p>
              <p className="text-sm text-gray-600">
                Líder:{' '}
                {g.lider_uid ? (
                  <Link
                    href={`/perfil/${g.lider_uid}`}
                    className="text-blue-600 hover:underline"
                  >
                    {userNames[g.lider_uid] || g.lider_uid}
                  </Link>
                ) : (
                  'vago'
                )}
              </p>
            </div>

            <div className="flex flex-col gap-2 items-end">
              {/* Select de desafiantes pendentes – só quando o ginásio é seu e há desafios pendentes */}
              {souLiderNoGinasio && desafiosPendentesComoLider.length > 0 && (
                <div className="flex flex-col items-end gap-1 text-xs mb-1">
                  <label className="text-gray-600">
                    Desafios pendentes neste ginásio:
                  </label>
                  <select
                    className="border rounded px-2 py-1 text-xs bg-white"
                    value={selectedDesafianteId}
                    onChange={(e) =>
                      setSelectedDesafiantePorGinasio((prev) => ({
                        ...prev,
                        [g.id]: e.target.value,
                      }))
                    }
                  >
                    {desafiantesPendentesIds.map((uid) => (
                      <option key={uid} value={uid}>
                        {userNames[uid] || uid}
                      </option>
                    ))}
                  </select>

                  {desafioSelecionadoComoLider && equipeDesafianteSelecionado.length > 0 && (
                    <div className="flex items-center gap-1 mt-1">
                      <span className="text-[11px] text-gray-600">
                        Equipe de {userNames[desafioSelecionadoComoLider.desafiante_uid] || 'desafiante'}:
                      </span>
                      <div className="flex -space-x-1">
                        {equipeDesafianteSelecionado.slice(0, 6).map((nome) => (
                          <PokemonMini key={nome} displayName={nome} size={20} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {disputaDoGinasio ? (
                <>
                  {jaNaDisputa ? (
                    <span className="text-xs text-gray-500">
                      Você já está na disputa
                    </span>
                  ) : (
                    <p>Entre na disputa pelo ginásio: {g.nome}</p>
                  )}
                  <Link
                    href={`/ginasios/${g.id}/disputa`}
                    className="text-xs text-blue-600 underline"
                  >
                    Ver disputa
                  </Link>
                </>
              ) : disputaBatalhandoGinasio ? (
                <Link
                  href={`/ginasios/${g.id}/disputa`}
                  className="text-xs text-blue-600 underline"
                >
                  Ver disputa
                </Link>
              ) : haDesafioPendente ? (
                souLiderNoGinasio && desafiosPendentesComoLider.length > 0 ? (
                  // você é o líder e tem vários desafiantes pendentes neste ginásio
                  <button
                    onClick={() =>
                      desafioSelecionadoComoLider &&
                      openDesafioChat(desafioSelecionadoComoLider.id)
                    }
                    disabled={!desafioSelecionadoComoLider}
                    className="px-3 py-1 bg-slate-800 text-white rounded text-sm disabled:opacity-50"
                  >
                    {desafioSelecionadoComoLider
                      ? `Abrir chat do desafio de ${
                          userNames[desafioSelecionadoComoLider.desafiante_uid] ||
                          'desafiante'
                        }`
                      : 'Abrir chat do desafio'}
                  </button>
                ) : desafioComoDesafiante ? (
                  // você é o desafiante (1 desafio pendente por ginásio)
                  <div className="flex flex-col gap-2 items-end">
                    {minhaEquipeLiga.length > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-600">Sua equipe:</span>
                        <div className="flex -space-x-1">
                          {minhaEquipeLiga.slice(0, 6).map((nome) => (
                            <PokemonMini key={nome} displayName={nome} size={24} />
                          ))}
                        </div>
                      </div>
                    )}

                    <button
                      onClick={() => openDesafioChat(desafioComoDesafiante.id)}
                      className="px-3 py-1 bg-slate-800 text-white rounded text-sm"
                    >
                      Abrir chat do desafio
                    </button>
                  </div>
                ) : null
              ) : (
                // Ainda não desafiou → botão "Desafiar" + sua equipe (se tiver)
                <div className="flex items-center gap-3">
                  {minhaEquipeLiga.length > 0 && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-gray-600">Sua equipe:</span>
                      <div className="flex -space-x-1">
                        {minhaEquipeLiga.slice(0, 6).map((nome) => (
                          <PokemonMini key={nome} displayName={nome} size={24} />
                        ))}
                      </div>
                    </div>
                  )}
                  <button
                    onClick={() => handleDesafiar(g)}
                    disabled={
                      bloqueado || semLider || jaTemInsignia || g.lider_uid === userUid
                    }
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
                </div>
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
                          <a
                            href={deep}
                            className="text-blue-600 text-sm hover:underline"
                          >
                            Abrir no Pokémon GO
                          </a>
                          <Image
                            src={qrSrc(native)}
                            alt="QR para adicionar"
                            width={160}
                            height={160}
                            className="w-40 h-40 border rounded"
                          />
                          <button
                            onClick={() =>
                              navigator.clipboard?.writeText(chatOtherFC!)
                            }
                            className="text-xs bg-slate-200 hover:bg-slate-300 px-2 py-1 rounded"
                          >
                            Copiar FC
                          </button>
                        </div>
                      );
                    })()}
                  </>
                ) : (
                  <p className="text-xs text-amber-600">
                    O outro jogador não cadastrou FC.
                  </p>
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
                          mine
                            ? 'self-end bg-blue-600 text-white'
                            : 'self-start bg-white border'
                        }`}
                      >
                        <p className="text-xs">{m.text}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2">
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
                  type="button"
                >
                  Enviar
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={declareResultadoVenci}
                  className="w-full bg-green-600 hover:bg-green-700 text-white text-sm px-3 py-2 rounded"
                  title="Você declara que VENCEU"
                  type="button"
                >
                  🏆 Venci
                </button>
                <button
                  onClick={declareResultadoFuiDerrotado}
                  className="w-full bg-red-600 hover:bg-red-700 text-white text-sm px-3 py-2 rounded"
                  title="Você declara que FOI DERROTADO"
                  type="button"
                >
                  Fui derrotado
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
