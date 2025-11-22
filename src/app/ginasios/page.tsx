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

// helpers para sprites de pokémon
function formatName(name: string) {
  return name
    .split('-')
    .map((w) => (w[0] ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

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

function buildFormSlug(displayName: string): string | null {
  const m = displayName.match(/^(.*)\((.+)\)\s*$/);
  if (!m) return null;
  const base = slugifyBase(m[1]);
  const token = suffixToToken(m[2]);
  return `${base}-${token}`;
}

function spriteMiniById(id: number) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
}

function officialArtworkById(id: number) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
}

// Miniatura utilizada para mostrar equipes
function PokemonMini({
  displayName,
  baseId,
  size = 24,
}: {
  displayName: string;
  baseId?: number;
  size?: number;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const formSlug = buildFormSlug(displayName);

      if (formSlug) {
        try {
          const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${formSlug}`);
          if (res.ok) {
            const data = await res.json();
            const formId = data?.id as number | undefined;
            if (!cancelled && formId) {
              setSrc(spriteMiniById(formId));
              return;
            }
          }
        } catch {
          // segue pro fallback
        }
      }

      if (baseId) {
        setSrc(officialArtworkById(baseId));
      } else {
        setSrc(null);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [displayName, baseId]);

  if (!src) return <span className="w-6 h-6 inline-block rounded bg-gray-300" />;

  return (
    <Image
      src={src}
      alt={displayName}
      width={size}
      height={size}
      onError={() => {
        if (baseId) {
          setSrc(spriteMiniById(baseId));
        } else {
          setSrc(null);
        }
      }}
    />
  );
}

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

  // mapa Nome base → ID para sprites
  const [nameToId, setNameToId] = useState<Record<string, number>>({});

  // equipes por usuário+liga (chave: `${uid}::${ligaNome}`)
  const [equipesUsuariosLiga, setEquipesUsuariosLiga] = useState<Record<string, string[]>>({});

  // nomes de usuários (para desafiantes)
  const [nomesUsuarios, setNomesUsuarios] = useState<Record<string, string>>({});

  // desafio selecionado por ginásio (para o líder alternar entre desafiantes)
  const [desafioSelecionadoPorGinasio, setDesafioSelecionadoPorGinasio] = useState<
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
  const [showChatInfo, setShowChatInfo] = useState(false);
  const chatUnsubRef = useRef<Unsubscribe | null>(null);
  const desafioUnsubRef = useRef<Unsubscribe | null>(null);
  const chatBoxRef = useRef<HTMLDivElement | null>(null);

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

  // scroll automático pro fim do chat
  useEffect(() => {
    if (chatOpen && chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [chatOpen, chatMsgs.length]);

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
      const list: Liga[] = snap.docs.map((d) => ({ id: d.id, nome: (d.data() as any).nome }));
      setLigas(list);
      if (list.length > 0) setSelectedLiga(list[0].nome);
    })();
  }, []);

  // 2.2) dex base (para mapear nome→id)
  useEffect(() => {
    const fetchPokemonList = async () => {
      try {
        const res = await fetch('https://pokeapi.co/api/v2/pokemon?limit=1010');
        const data = await res.json();
        const map: Record<string, number> = {};
        data.results.forEach((p: { name: string }, i: number) => {
          map[formatName(p.name)] = i + 1;
        });
        setNameToId(map);
      } catch {
        setNameToId({});
      }
    };
    fetchPokemonList();
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
    if (ginasios.length) loadLideres();
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
        return { id: d.id, ginasio_id: data.ginasio_id, temporada_id: data.temporada_id || '' };
      });
      setMinhasInsignias(list);
    });
    return () => unsub();
  }, [userUid]);

  // 10) nomes dos desafiantes (para mostrar no select do líder)
  useEffect(() => {
    async function loadUsuariosDesafiantes() {
      const ids = new Set<string>();
      desafios.forEach((d) => {
        ids.add(d.desafiante_uid);
      });

      const novos: Record<string, string> = {};
      for (const uid of ids) {
        if (nomesUsuarios[uid]) continue;
        try {
          const uSnap = await getDoc(doc(db, 'usuarios', uid));
          if (uSnap.exists()) {
            const ud = uSnap.data() as any;
            novos[uid] = ud.nome || ud.email || uid;
          } else {
            novos[uid] = uid;
          }
        } catch {
          novos[uid] = uid;
        }
      }

      if (Object.keys(novos).length > 0) {
        setNomesUsuarios((prev) => ({ ...prev, ...novos }));
      }
    }

    if (desafios.length > 0) {
      loadUsuariosDesafiantes();
    }
  }, [desafios, nomesUsuarios]);

  // 11) equipes por usuário+liga (meu time e times dos desafiantes)
  useEffect(() => {
    if (!temporada || !ligas.length || !userUid) return;

    const ligasMap = new Map(ligas.map((l) => [l.nome, l.id]));

    const combosSet = new Set<string>();

    // sempre minha equipe da liga selecionada
    if (selectedLiga) {
      combosSet.add(`${userUid}::${selectedLiga}`);
    }

    // equipes dos desafiantes (liga gravada no desafio)
    desafios.forEach((d) => {
      if (!d.liga) return;
      combosSet.add(`${d.desafiante_uid}::${d.liga}`);
    });

    const combos = Array.from(combosSet);
    if (combos.length === 0) return;

    const carregar = async () => {
      const novos: Record<string, string[]> = {};

      await Promise.all(
        combos.map(async (combo) => {
          if (equipesUsuariosLiga[combo]) {
            return;
          }

          const [uid, ligaNome] = combo.split('::');
          const ligaId = ligasMap.get(ligaNome);
          if (!ligaId) {
            novos[combo] = [];
            return;
          }

          try {
            const partSnap = await getDocs(
              query(
                collection(db, 'participacoes'),
                where('usuario_id', '==', uid),
                where('liga_id', '==', ligaId),
                where('temporada_id', '==', temporada.id)
              )
            );
            const partDoc = partSnap.docs[0];
            if (!partDoc) {
              novos[combo] = [];
              return;
            }

            const pokSnap = await getDocs(
              query(collection(db, 'pokemon'), where('participacao_id', '==', partDoc.id))
            );
            const nomes = pokSnap.docs.map((p) => (p.data() as any).nome as string);
            novos[combo] = nomes;
          } catch {
            novos[combo] = [];
          }
        })
      );

      if (Object.keys(novos).length > 0) {
        setEquipesUsuariosLiga((prev) => ({ ...prev, ...novos }));
      }
    };

    carregar();
  }, [temporada, ligas, desafios, selectedLiga, userUid, equipesUsuariosLiga]);

  // util para encerrar período de liderança aberto
  async function encerrarLideratoSeAberto(ginasioId: string, liderUid: string) {
    try {
      const qAberto = query(
        collection(db, 'ginasios_liderancas'),
        where('ginasio_id', '==', ginasioId),
        where('lider_uid', '==', liderUid)
      );
      const snap = await getDocs(qAberto);
      const pendentes = snap.docs.filter((d) => {
        const x = d.data() as any;
        return x.fim === null || x.fim === undefined;
      });
      await Promise.all(
        pendentes.map((d) => updateDoc(doc(db, 'ginasios_liderancas', d.id), { fim: Date.now() }))
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
    setShowChatInfo(false);

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
    setShowChatInfo(false);
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

            await updateDoc(gRef, {
              lider_uid: '',
              em_disputa: true,
              derrotas_seguidas: 0,
            });
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

  const minhaEquipeLiga =
    userUid && selectedLiga
      ? equipesUsuariosLiga[`${userUid}::${selectedLiga}`] || []
      : [];

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
          className="bg-purple-600 text-white px-3 py-2 rounded text-sm"
        >
          Ver tutorial
        </button>
      </div>

      {ginasiosFiltrados.map((g) => {
        const meuDesafioComoDesafiante = desafios.find(
          (d) =>
            d.ginasio_id === g.id &&
            !d.disputa_id &&
            d.desafiante_uid === userUid &&
            d.status === 'pendente'
        );

        const desafiosPendentesGinasio = desafios.filter(
          (d) => d.ginasio_id === g.id && !d.disputa_id && d.status === 'pendente'
        );

        const souLiderDesseGinasio = g.lider_uid === userUid;

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

        const desafioSelecionadoId =
          desafiosPendentesGinasio.length > 0
            ? desafioSelecionadoPorGinasio[g.id] || desafiosPendentesGinasio[0].id
            : null;

        const desafioSelecionado =
          desafiosPendentesGinasio.find((d) => d.id === desafioSelecionadoId) || null;

        const equipeDesafianteSelecionado =
          desafioSelecionado && desafioSelecionado.liga
            ? equipesUsuariosLiga[
                `${desafioSelecionado.desafiante_uid}::${desafioSelecionado.liga}`
              ] || []
            : [];

        return (
          <div
            key={g.id}
            className="card p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
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
              {g.liga && (
                <p className="text-xs text-gray-400 mb-1">Liga: {g.liga}</p>
              )}
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
                    {liderNomes[g.lider_uid] || g.lider_uid}
                  </Link>
                ) : (
                  'vago'
                )}
              </p>
            </div>

            <div className="flex flex-col gap-2 items-stretch md:items-end w-full md:w-auto">
              {disputaDoGinasio ? (
                <>
                  {jaNaDisputa ? (
                    <span className="text-xs text-gray-500">
                      Você já está na disputa
                    </span>
                  ) : (
                    <p className="text-xs text-gray-700 text-right">
                      Entre na disputa pelo ginásio: {g.nome}
                    </p>
                  )}
                  <Link
                    href={`/ginasios/${g.id}/disputa`}
                    className="text-xs text-blue-600 underline self-end"
                  >
                    Ver disputa
                  </Link>
                </>
              ) : disputaBatalhandoGinasio ? (
                <Link
                  href={`/ginasios/${g.id}/disputa`}
                  className="text-xs text-blue-600 underline self-end"
                >
                  Ver disputa
                </Link>
              ) : souLiderDesseGinasio && desafiosPendentesGinasio.length > 0 ? (
                <>
                  <div className="flex flex-col gap-1 items-stretch md:items-end">
                    <label className="text-xs text-gray-500">
                      Desafios pendentes:
                    </label>
                    <select
                      value={desafioSelecionado?.id || ''}
                      onChange={(e) =>
                        setDesafioSelecionadoPorGinasio((prev) => ({
                          ...prev,
                          [g.id]: e.target.value,
                        }))
                      }
                      className="border rounded px-2 py-1 text-xs md:text-sm"
                    >
                      {desafiosPendentesGinasio.map((d) => (
                        <option key={d.id} value={d.id}>
                          {nomesUsuarios[d.desafiante_uid] || d.desafiante_uid}
                        </option>
                      ))}
                    </select>
                  </div>

                  {desafioSelecionado && (
                    <>
                      {equipeDesafianteSelecionado.length > 0 && (
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          <span className="text-xs text-gray-600">
                            Equipe de{' '}
                            {nomesUsuarios[desafioSelecionado.desafiante_uid] ||
                              desafioSelecionado.desafiante_uid}
                            :
                          </span>
                          <div className="flex -space-x-1">
                            {equipeDesafianteSelecionado.slice(0, 6).map((nome) => {
                              const baseName = nome.replace(/\s*\(.+\)\s*$/, '');
                              const baseId = nameToId[baseName];
                              return (
                                <PokemonMini
                                  key={nome}
                                  displayName={nome}
                                  baseId={baseId}
                                  size={24}
                                />
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <button
                        onClick={() => openDesafioChat(desafioSelecionado.id)}
                        className="px-3 py-1 bg-slate-800 text-white rounded text-xs md:text-sm"
                      >
                        Abrir chat do desafio de{' '}
                        {nomesUsuarios[desafioSelecionado.desafiante_uid] ||
                          desafioSelecionado.desafiante_uid}
                      </button>
                    </>
                  )}
                </>
              ) : meuDesafioComoDesafiante ? (
                <>
                  {minhaEquipeLiga.length > 0 && (
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      <span className="text-xs text-gray-600">Sua equipe:</span>
                      <div className="flex -space-x-1">
                        {minhaEquipeLiga.slice(0, 6).map((nome) => {
                          const baseName = nome.replace(/\s*\(.+\)\s*$/, '');
                          const baseId = nameToId[baseName];
                          return (
                            <PokemonMini
                              key={nome}
                              displayName={nome}
                              baseId={baseId}
                              size={24}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <button
                    onClick={() => openDesafioChat(meuDesafioComoDesafiante.id)}
                    className="px-3 py-1 bg-slate-800 text-white rounded text-xs md:text-sm self-end"
                  >
                    Abrir chat do desafio
                  </button>
                </>
              ) : (
                <div className="flex flex-col gap-2 items-end md:flex-row md:items-center md:gap-3">
                  {minhaEquipeLiga.length > 0 && (
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      <span className="text-xs text-gray-600">Sua equipe:</span>
                      <div className="flex -space-x-1">
                        {minhaEquipeLiga.slice(0, 6).map((nome) => {
                          const baseName = nome.replace(/\s*\(.+\)\s*$/, '');
                          const baseId = nameToId[baseName];
                          return (
                            <PokemonMini
                              key={nome}
                              displayName={nome}
                              baseId={baseId}
                              size={24}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <button
                    onClick={() => handleDesafiar(g)}
                    disabled={bloqueado || semLider || jaTemInsignia || g.lider_uid === userUid}
                    className="px-3 py-1 bg-yellow-500 text-white rounded text-sm disabled:opacity-50 w-full md:w-auto"
                  >
                    {g.lider_uid === userUid
                      ? 'Você é o líder'
                      : semLider
                      ? 'Sem líder'
                      : jaTemInsignia
                      ? 'Já ganhou'
                      : bloqueado
                      ? 'Aguarde novo desafio'
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
          <div className="relative bg-white w-full max-w-2xl max-h-[90vh] rounded-xl shadow-xl p-3 md:p-5 flex flex-col">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Desafio & Chat</h3>
                <p className="text-xs text-slate-600">
                  Combine a batalha e depois declare o resultado.
                </p>
              </div>
              <button
                className="text-slate-500 hover:text-slate-800 text-sm"
                onClick={closeDesafioChat}
              >
                Fechar
              </button>
            </div>

            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="border rounded-lg p-3">
                <p className="text-xs text-slate-500">Adicionar {chatOtherName}:</p>
                {chatOtherFC ? (
                  <>
                    <p className="text-sm font-semibold mt-1">FC: {chatOtherFC}</p>
                    {(() => {
                      const { native, androidIntent } =
                        buildPoGoFriendLinks(chatOtherFC!);
                      const deep = isAndroid ? androidIntent : native;
                      return (
                        <div className="mt-2 flex flex-col items-start gap-2">
                          <a
                            href={deep}
                            className="text-blue-600 text-xs hover:underline"
                          >
                            Abrir no Pokémon GO
                          </a>
                          <Image
                            src={qrSrc(native)}
                            alt="QR para adicionar"
                            width={140}
                            height={140}
                            className="w-36 h-36 border rounded"
                          />
                          <div className="w-full flex items-center justify-between gap-2">
                            <button
                              onClick={() =>
                                navigator.clipboard?.writeText(chatOtherFC!)
                              }
                              className="text-[11px] bg-slate-200 hover:bg-slate-300 px-2 py-1 rounded"
                            >
                              Copiar FC
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowChatInfo((v) => !v)}
                              className="flex items-center gap-1 text-[11px] text-slate-700"
                            >
                              <span>Converse com o adversário</span>
                              <span className="w-4 h-4 flex items-center justify-center rounded-full bg-slate-100 border border-slate-300 text-[10px] font-bold">
                                i
                              </span>
                            </button>
                          </div>
                          {showChatInfo && (
                            <div className="text-[11px] text-slate-600 mt-1">
                              <ul className="list-disc pl-4 space-y-1">
                                <li>Combine dia, horário e se será presencial ou remoto.</li>
                                <li>Confirme a liga usada e a quantidade de partidas.</li>
                                <li>
                                  Se der problema (no app, conexão, atraso), registre aqui antes
                                  de declarar o resultado.
                                </li>
                              </ul>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </>
                ) : (
                  <p className="text-xs text-amber-600 mt-1">
                    O outro jogador não cadastrou FC.
                  </p>
                )}
              </div>
            </div>

            <div
              ref={chatBoxRef}
              className="mt-3 border rounded-lg p-2 max-h-52 md:max-h-60 overflow-auto bg-slate-50"
            >
              {chatMsgs.length === 0 ? (
                <p className="text-xs text-slate-500">Nenhuma mensagem ainda.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {chatMsgs.map((m) => {
                    const mine = m.from === userUid;
                    return (
                      <div
                        key={m.id}
                        className={`max-w-[85%] px-3 py-2 rounded text-xs ${
                          mine
                            ? 'self-end bg-blue-600 text-white'
                            : 'self-start bg-white border'
                        }`}
                      >
                        <p>{m.text}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-2 space-y-2">
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
                  className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-3 py-2 rounded"
                  type="button"
                >
                  Enviar
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={declareResultadoVenci}
                  className="w-full bg-green-600 hover:bg-green-700 text-white text-xs md:text-sm px-3 py-2 rounded"
                  title="Você declara que VENCEU"
                  type="button"
                >
                  🏆 Venci
                </button>
                <button
                  onClick={declareResultadoFuiDerrotado}
                  className="w-full bg-red-600 hover:bg-red-700 text-white text-xs md:text-sm px-3 py-2 rounded"
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
