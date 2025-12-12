'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { setResultadoEFecharSePossivel } from '@/lib/desafiosService';
import { auth, db } from '@/lib/firebase';
import {
  collection,
  collectionGroup,
  query,
  where,
  onSnapshot,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  getDocs,
  orderBy,
  deleteDoc,
  serverTimestamp,
  increment,
  limit,
  runTransaction,
} from 'firebase/firestore';
import type { Unsubscribe } from 'firebase/firestore';
import { TYPE_ICONS } from '@/utils/typeIcons';
import { onAuthStateChanged, type User } from 'firebase/auth';

/* =======================
   Types
======================= */

type Usuario = {
  id: string;
  nome?: string;
  email?: string;
  friend_code?: string;
  // PP
  pontosPresencaTotal?: number;
  ppConsumidos?: number;
  ppDisponiveis?: number;
  // verificação
  verificado?: boolean;
  autenticadoPorAdm?: boolean;
};

type Ginasio = {
  id: string;
  nome: string;
  tipo: string;
  lider_uid: string;
  derrotas_seguidas?: number;
  em_disputa?: boolean;
  insignia_icon?: string;
  liga?: string;
};

type DisputaParticipante = {
  id: string;
  disputa_id: string;
  ginasio_id: string;
  tipo_escolhido?: string;
  ginasio_nome?: string;
  disputa_status?: string;
};

type Desafio = {
  id: string;
  ginasio_id: string;
  lider_uid: string;
  desafiante_uid: string;
  status: string;
  criadoEm?: number;
  desafiante_nome?: string;
  liga?: string;
  resultado_lider?: 'lider' | 'desafiante' | null;
  resultado_desafiante?: 'lider' | 'desafiante' | null;
};

type Insignia = {
  id: string;
  ginasio_id: string;
  ginasio_nome?: string;
  ginasio_tipo?: string;
  insignia_icon?: string;
  temporada_id?: string;
  temporada_nome?: string;
  liga?: string;
  createdAt?: number;
  lider_derrotado_uid?: string;
  usuario_uid?: string;
};

type Liga = {
  id?: string;
  nome: string;
};

type Elite4Participacao = {
  id: string;
  campeonato_id: string;
  liga: string;
  status: 'aberto' | 'fechado';
  pontos: number;
};

type Temporada = {
  id: string;
  nome?: string;
  ativa?: boolean;
  createdAt?: number;
};

/* === NOVOS TIPOS PARA HISTÓRICO === */
type Liderato = {
  id: string;
  ginasio_id: string;
  lider_uid: string;
  inicio: number;
  fim?: number | null;
  liga?: string;
};

type EliteMandato = {
  id: string;
  usuario_uid: string;
  liga?: string;
  inicio: number;
  fim?: number | null;
};

/* =======================
   Helpers
======================= */

// custo do Wish: base + up * nível (nível = usos, clamp 0–3)
function computeWishCost(base: number, up: number, uses: number) {
  const b = Number.isFinite(base) ? base : 0;
  const u = Number.isFinite(up) ? up : 0;
  const n = uses < 0 ? 0 : uses;
  const level = Math.min(n, 3);
  if (b <= 0) return 0;
  return b + u * level;
}

async function getElite4CampeonatoAtivoId(db: any, liga?: string): Promise<string | null> {
  // tenta por "ativo"
  const q1 = liga
    ? query(collection(db, 'campeonatos_elite4'), where('ativo', '==', true), where('liga', '==', liga), limit(1))
    : query(collection(db, 'campeonatos_elite4'), where('ativo', '==', true), limit(1));
  let s = await getDocs(q1);
  if (!s.empty) return s.docs[0].id;

  // fallback por "status: aberto"
  const q2 = liga
    ? query(collection(db, 'campeonatos_elite4'), where('status', '==', 'aberto'), where('liga', '==', liga), limit(1))
    : query(collection(db, 'campeonatos_elite4'), where('status', '==', 'aberto'), limit(1));
  s = await getDocs(q2);
  return s.empty ? null : s.docs[0].id;
}

async function resetElite4PontuacaoDoUsuario(
  db: any,
  userUid: string,
  ginasioId?: string,
  liga?: string,
  motivo?: 'renuncia' | '3_derrotas'
) {
  if (!userUid) return;
  const campId = await getElite4CampeonatoAtivoId(db, liga);
  if (!campId) return;

  const ref = doc(db, 'campeonatos_elite4', campId, 'participantes', userUid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    // CREATE (pode setar lastReset*)
    await setDoc(ref, {
      usuario_uid: userUid,
      campeonato_id: campId,
      ginasio_id: ginasioId ?? null,
      liga: liga ?? '',
      pontos: 0,
      createdAt: Date.now(),
      lastResetAt: serverTimestamp(),
      lastResetReason: motivo ?? 'renuncia',
    });
  } else {
    // UPDATE pelo líder: NÃO toque em lastReset* (as regras exigem igualdade)
    await updateDoc(ref, {
      ginasio_id: ginasioId ?? null,
      pontos: 0,
    });
  }
}

/* =======================
   Page
======================= */

type TabId = 'insig_hist' | 'desafios' | 'ginasios' | 'disputas';

export default function PerfilPage() {
  const params = useParams();
  const router = useRouter();
  const perfilUid = params?.id as string;

  /* Auth / user */
  const [logadoUid, setLogadoUid] = useState<string | null>(null);
  const [usuario, setUsuario] = useState<Usuario | null>(null);

  /* Gym / disputes */
  const [ginasiosLider, setGinasiosLider] = useState<Ginasio[]>([]);
  const [minhasInscricoes, setMinhasInscricoes] = useState<DisputaParticipante[]>([]);
  const [desafiosComoLider, setDesafiosComoLider] = useState<Desafio[]>([]);
  const [eliteParts, setEliteParts] = useState<Elite4Participacao[]>([]);
  const [ginasiosMap, setGinasiosMap] = useState<Record<string, { nome: string; liga: string }>>(
    {}
  );

  /* Ligas e filtro */
  const [ligas, setLigas] = useState<Liga[]>([]);
  const [ligaSelecionada, setLigaSelecionada] = useState<string>('');

  /* Temporadas e filtro */
  const [temporadas, setTemporadas] = useState<Temporada[]>([]);
  const [temporadasMap, setTemporadasMap] = useState<Record<string, Temporada>>({});
  const [temporadaSelecionada, setTemporadaSelecionada] = useState<string>(''); // '' = Todas

  /* Temporada ativa */
  const [temporadaAtiva, setTemporadaAtiva] = useState<{ id: string; nome?: string } | null>(null);

  /* Insígnias */
  const [insignias, setInsignias] = useState<Insignia[]>([]);

  /* Líder à época */
  const [liderNomes, setLiderNomes] = useState<Record<string, string>>({});

  /* Chat */
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDesafioId, setChatDesafioId] = useState<string | null>(null);
  const [chatMsgs, setChatMsgs] = useState<{ id: string; from: string; text: string; createdAt: any }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatOtherName, setChatOtherName] = useState('Treinador');
  const [chatOtherFC, setChatOtherFC] = useState<string | null>(null);
  const [souLiderNoChat, setSouLiderNoChat] = useState(false);
  const [jaDeclarei, setJaDeclarei] = useState(false);
  const [jaDeclareiMsg, setJaDeclareiMsg] = useState<string | null>(null);

  const chatUnsubRef = useRef<Unsubscribe | null>(null);
  const desafioUnsubRef = useRef<Unsubscribe | null>(null);
  const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '');
  const qrSrc = (data: string) =>
    `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(data)}`;
  const buildPoGoFriendLinks = (fc: string) => {
    const native = `pokemongo://?dl_action=AddFriend&DlId=${encodeURIComponent(fc)}`;
    const androidIntent = `intent://?dl_action=AddFriend&DlId=${encodeURIComponent(
      fc
    )}#Intent;scheme=pokemongo;package=com.nianticlabs.pokemongo;end`;
    return { native, androidIntent };
  };

  const [loading, setLoading] = useState(true);
  const ehMeuPerfil = logadoUid === perfilUid;

  /* Histórico */
  const [lideratos, setLideratos] = useState<Liderato[]>([]);
  const [eliteMandatos, setEliteMandatos] = useState<EliteMandato[]>([]);
  const [renunciando, setRenunciando] = useState<string | null>(null);

  /* PP para remover derrota (Wish) */
  const [ppCustoWish, setPpCustoWish] = useState<number | null>(null);
  const [ppUpWish, setPpUpWish] = useState<number | null>(null);
  const [ppUsandoGinasioId, setPpUsandoGinasioId] = useState<string | null>(null);
  const [wishUses, setWishUses] = useState<number>(0);

  /* ABA ATIVA */
  const [tab, setTab] = useState<TabId>('insig_hist');

  /* =======================
     Effects: auth / lookups
  ======================= */

  useEffect(() => {
    setLogadoUid(auth.currentUser?.uid ?? null);

    const unsub = onAuthStateChanged(auth, (u: User | null) => {
      setLogadoUid(u?.uid ?? null);
    });

    return unsub;
  }, []);

  /* Ligas */
  useEffect(() => {
    (async () => {
      const snap = await getDocs(collection(db, 'ligas'));
      const list: Liga[] = snap.docs.map((d) => ({ id: d.id, nome: (d.data() as any).nome || d.id }));
      setLigas(list);
    })();
  }, []);

  /* Temporadas (lista + map) */
  useEffect(() => {
    (async () => {
      const snap = await getDocs(collection(db, 'temporadas'));
      const list: Temporada[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          nome: data.nome || d.id,
          ativa: !!data.ativa,
          createdAt: data.createdAt || 0,
        };
      });

      list.sort((a, b) => {
        if (a.ativa && !b.ativa) return -1;
        if (!a.ativa && b.ativa) return 1;
        const ca = a.createdAt || 0;
        const cb = b.createdAt || 0;
        return cb - ca;
      });

      setTemporadas(list);
      setTemporadasMap(Object.fromEntries(list.map((t) => [t.id, t])));
    })();
  }, []);

  /* Temporada ativa */
  useEffect(() => {
    (async () => {
      try {
        const qTemp = query(collection(db, 'temporadas'), where('ativa', '==', true));
        const snap = await getDocs(qTemp);
        if (!snap.empty) {
          const d = snap.docs[0];
          const data = d.data() as any;
          setTemporadaAtiva({ id: d.id, nome: data.nome });
        }
      } catch (e) {
        console.warn('erro carregando temporada ativa', e);
      }
    })();
  }, []);

  /* Usuário do perfil + PP + usos do Wish por temporada */
  useEffect(() => {
    if (!perfilUid) return;
    (async () => {
      try {
        const uSnap = await getDoc(doc(db, 'usuarios', perfilUid));
        if (uSnap.exists()) {
          const d = uSnap.data() as any;

          const total: number = d.pontosPresenca ?? 0;
          const consumidos: number = (d.pontosPresencaConsumidos ?? d.pp_consumidos ?? 0) as number;
          const disponiveis = Math.max(0, total - consumidos);

          const rawWishUses: number = (d.pp_wish_uses ?? 0) as number;
          const storedSeasonId: string | null = d.pp_wish_temporadaId ?? null;
          const activeSeasonId = temporadaAtiva?.id ?? null;

          const effectiveWishUses =
            activeSeasonId && storedSeasonId === activeSeasonId ? Math.max(0, rawWishUses) : 0;

          setWishUses(effectiveWishUses);

          setUsuario({
            id: perfilUid,
            nome: d.nome,
            email: d.email,
            friend_code: d.friend_code,
            pontosPresencaTotal: total,
            ppConsumidos: consumidos,
            ppDisponiveis: disponiveis,
            verificado: !!d.verificado,
            autenticadoPorAdm: !!(d.autenticadoPorAdm || d.autenticado_por_adm),
          });
        } else {
          setUsuario({
            id: perfilUid,
            pontosPresencaTotal: 0,
            ppConsumidos: 0,
            ppDisponiveis: 0,
          });
          setWishUses(0);
        }
      } catch {
        setUsuario({
          id: perfilUid,
          pontosPresencaTotal: 0,
          ppConsumidos: 0,
          ppDisponiveis: 0,
        });
        setWishUses(0);
      } finally {
        setLoading(false);
      }
    })();
  }, [perfilUid, temporadaAtiva]);

  /* Custo base em PP para ações tipo Wish */
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'consumoPP', 'PPcustoWish'));
        if (!snap.exists()) return;
        const data = snap.data() as any;
        const v = Number(data.valor ?? data.value ?? 0);
        if (Number.isFinite(v) && v > 0) {
          setPpCustoWish(v);
        } else {
          console.warn('PPcustoWish.valor inválido:', data.valor);
        }
      } catch (e) {
        console.warn('Erro carregando consumoPP/PPcustoWish:', e);
      }
    })();
  }, []);

  // quanto o Wish sobe por uso (ex.: 2 → +2 PP por uso)
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'consumoPP', 'PPupWish'));
        if (!snap.exists()) return;

        const data = snap.data() as any;
        const v = Number(data.valor ?? 0);
        if (Number.isFinite(v)) {
          setPpUpWish(v);
        }
      } catch (e) {
        console.warn('Erro carregando consumoPP/PPupWish:', e);
      }
    })();
  }, []);

  /* Ginásios que lidera (realtime) */
  useEffect(() => {
    if (!perfilUid) return;
    const qG = query(collection(db, 'ginasios'), where('lider_uid', '==', perfilUid));
    const unsub = onSnapshot(qG, (snap) => {
      const list: Ginasio[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          nome: data.nome,
          tipo: data.tipo || '',
          lider_uid: data.lider_uid,
          derrotas_seguidas: data.derrotas_seguidas ?? 0,
          em_disputa: data.em_disputa ?? false,
          insignia_icon: data.insignia_icon || '',
          liga: data.liga || '',
        };
      });
      setGinasiosLider(list);
    });
    return () => unsub();
  }, [perfilUid]);

  /* Mapa completo de ginásios */
  useEffect(() => {
    (async () => {
      const snap = await getDocs(collection(db, 'ginasios'));
      const mp: Record<string, { nome: string; liga: string }> = {};
      snap.forEach((g) => {
        const data = g.data() as any;
        mp[g.id] = { nome: data.nome || g.id, liga: data.liga || data.liga_nome || '' };
      });
      setGinasiosMap(mp);
    })();
  }, []);

  /* Disputas que participa (realtime)
  useEffect(() => {
    if (!perfilUid) return;
    const qP = query(
      collectionGroup(db, 'participantes'),
      where('usuario_uid', '==', perfilUid)
    );
    const unsub = onSnapshot(qP, async (snap) => {
      const rows: Elite4Participacao[] = [];
      for (const d of snap.docs) {
        const x = d.data() as any;
        const campId = (x.campeonato_id as string) || d.ref.parent.parent?.id;
        if (!campId) continue;

        const pontos = Number(x.pontos ?? 0);
        const cDoc = await getDoc(doc(db, 'campeonatos_elite4', campId));
        if (!cDoc.exists()) continue;
        const cd = cDoc.data() as any;

        rows.push({
          id: d.id, // uid do participante
          campeonato_id: campId,
          liga: cd.liga || '',
          status: (cd.status as 'aberto' | 'fechado') || 'aberto',
          pontos,
        });
      }
      setEliteParts(rows);
    });
    return () => unsub();
  }, [perfilUid]); */

  /* Desafios pendentes para o LÍDER (realtime) */
  useEffect(() => {
    if (!perfilUid || !ehMeuPerfil) {
      setDesafiosComoLider([]);
      return;
    }

    const qD = query(
      collection(db, 'desafios_ginasio'),
      where('lider_uid', '==', perfilUid),
      where('status', '==', 'pendente')
    );

    const unsub = onSnapshot(qD, async (snap) => {
      const list: Desafio[] = [];
      for (const d of snap.docs) {
        const data = d.data() as any;
        let desafiante_nome: string | undefined;
        const uSnap = await getDoc(doc(db, 'usuarios', data.desafiante_uid));
        if (uSnap.exists()) {
          const u = uSnap.data() as any;
          desafiante_nome = u.nome || u.email;
        }
        list.push({
          id: d.id,
          ginasio_id: data.ginasio_id,
          lider_uid: data.lider_uid,
          desafiante_uid: data.desafiante_uid,
          status: data.status,
          criadoEm: data.criadoEm,
          desafiante_nome,
          liga: data.liga || '',
          resultado_lider: data.resultado_lider ?? null,
          resultado_desafiante: data.resultado_desafiante ?? null,
        });
      }
      setDesafiosComoLider(list);
    });

    return () => unsub();
  }, [perfilUid, ehMeuPerfil]);

  /* Participação em Elite4 (realtime) — novo (subcoleção) */
  useEffect(() => {
    if (!perfilUid || !ehMeuPerfil || !logadoUid) return;

    const qP = query(collectionGroup(db, 'participantes'), where('usuario_uid', '==', perfilUid));
    const unsub = onSnapshot(qP, async (snap) => {
      const disputas: DisputaParticipante[] = [];
      const elite: Elite4Participacao[] = [];

      await Promise.all(snap.docs.map(async (d) => {
        const data = d.data() as any;
        try {
          const parentDoc = d.ref.parent.parent!;
          const parentCol = parentDoc.parent.id;
          const parentSnap = await getDoc(parentDoc);
          const parent = parentSnap.exists() ? (parentSnap.data() as any) : {};

          if (parentCol === 'disputas_ginasio') {
            disputas.push({
              id: d.id,
              disputa_id: parentDoc.id,
              ginasio_id: data.ginasio_id,
              tipo_escolhido: data.tipo_escolhido ?? '',
              ginasio_nome: ginasiosMap[data.ginasio_id]?.nome ?? data.ginasio_id,
              disputa_status: parent.status ?? '—',
            });
          } else if (parentCol === 'campeonatos_elite4') {
            elite.push({
              id: d.id,
              campeonato_id: parentDoc.id,
              liga: parent.liga || '',
              status: (parent.status as 'aberto' | 'fechado') || 'aberto',
              pontos: Number(data.pontos ?? 0),
            });
          }
        } catch {
          // fallback silencioso para não poluir o console
        }
      }));

      setMinhasInscricoes(disputas);
      setEliteParts(elite);
    });

    return () => unsub();
  }, [perfilUid, ehMeuPerfil, logadoUid, ginasiosMap]);

  /* Insígnias do jogador (realtime) */
  useEffect(() => {
    if (!perfilUid) return;
    const qIns = query(collection(db, 'insignias'), where('usuario_uid', '==', perfilUid));
    const unsub = onSnapshot(qIns, (snap) => {
      const list: Insignia[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          ginasio_id: data.ginasio_id,
          ginasio_nome: data.ginasio_nome || '',
          ginasio_tipo: data.ginasio_tipo || '',
          insignia_icon: data.insignia_icon || '',
          temporada_id: data.temporada_id || '',
          temporada_nome: data.temporada_nome || '',
          liga: data.liga || '',
          createdAt: data.createdAt || 0,
          lider_derrotado_uid: data.lider_derrotado_uid || '',
          usuario_uid: data.usuario_uid,
        };
      });
      setInsignias(list);
    });
    return () => unsub();
  }, [perfilUid]);

  /* Resolver nomes dos líderes “à época” */
  useEffect(() => {
    (async () => {
      const uids = Array.from(new Set(insignias.map((i) => i.lider_derrotado_uid).filter(Boolean) as string[]));
      if (uids.length === 0) return;

      const map: Record<string, string> = {};
      for (const uid of uids) {
        try {
          const u = await getDoc(doc(db, 'usuarios', uid));
          if (u.exists()) {
            const d = u.data() as any;
            map[uid] = d.nome || d.email || uid;
          } else {
            map[uid] = uid;
          }
        } catch {
          map[uid] = uid;
        }
      }
      setLiderNomes((prev) => ({ ...prev, ...map }));
    })();
  }, [insignias]);

  /* Liderato (ginasios_liderancas) */
  useEffect(() => {
    if (!perfilUid) return;
    const qL = query(collection(db, 'ginasios_liderancas'), where('lider_uid', '==', perfilUid));
    const unsub = onSnapshot(qL, (snap) => {
      const list: Liderato[] = snap.docs.map((d) => {
        const x = d.data() as any;
        const inicio = Number(x.inicio ?? x.startedAt ?? 0);
        const fim = (x.fim ?? x.endedAt ?? null) as number | null;
        return {
          id: d.id,
          ginasio_id: x.ginasio_id,
          lider_uid: x.lider_uid,
          inicio,
          fim,
          liga: x.liga || '',
        };
      });
      setLideratos(list);
    });
    return () => unsub();
  }, [perfilUid]);

  /* Elite 4 (elite4_mandatos) */
  useEffect(() => {
    if (!perfilUid) return;
    const qE = query(collection(db, 'elite4_mandatos'), where('usuario_uid', '==', perfilUid));
    const unsub = onSnapshot(qE, (snap) => {
      const list: EliteMandato[] = snap.docs.map((d) => {
        const x = d.data() as any;
        return {
          id: d.id,
          usuario_uid: x.usuario_uid,
          liga: x.liga || '',
          inicio: Number(x.inicio || 0),
          fim: x.fim ?? null,
        };
      });
      setEliteMandatos(list);
    });
    return () => unsub();
  }, [perfilUid]);

  useEffect(() => {
    return () => {
      chatUnsubRef.current?.();
      desafioUnsubRef.current?.();
    };
  }, []);

  /* =======================
     Helpers / Derivations
  ======================= */

  // custo atual do Desejo para este jogador/temporada
  const custoWishComUp = useMemo(() => {
    if (ppCustoWish == null || ppCustoWish <= 0) return null;
    const up = Number.isFinite(ppUpWish ?? 0) ? (ppUpWish as number) : 0;
    return computeWishCost(ppCustoWish, up, wishUses);
  }, [ppCustoWish, ppUpWish, wishUses]);

  const ginasiosFiltrados = useMemo(() => {
    return ginasiosLider.filter((g) => (!ligaSelecionada ? true : (g.liga || '') === ligaSelecionada));
  }, [ginasiosLider, ligaSelecionada]);

  const insigniasFiltradasLiga = useMemo(() => {
    return insignias.filter((ins) => (!ligaSelecionada ? true : (ins.liga || '') === ligaSelecionada));
  }, [insignias, ligaSelecionada]);

  const insigniasFiltradasTemporada = useMemo(() => {
    if (!temporadaSelecionada) return insigniasFiltradasLiga;
    return insigniasFiltradasLiga.filter((ins) => (ins.temporada_id || '') === temporadaSelecionada);
  }, [insigniasFiltradasLiga, temporadaSelecionada]);

  const gruposPorTemporada = useMemo(() => {
    const map: Record<string, Insignia[]> = {};
    for (const ins of insigniasFiltradasLiga) {
      const key = ins.temporada_id || '__sem_temporada__';
      if (!map[key]) map[key] = [];
      map[key].push(ins);
    }
    Object.values(map).forEach((arr) => arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
    const entries = Object.entries(map).sort((a, b) => {
      const [ta, arrA] = a;
      const [tb, arrB] = b;
      if (temporadaAtiva?.id) {
        if (ta === temporadaAtiva.id && tb !== temporadaAtiva.id) return -1;
        if (tb === temporadaAtiva.id && ta !== temporadaAtiva.id) return 1;
      }
      const maxA = Math.max(...arrA.map((x) => x.createdAt || 0));
      const maxB = Math.max(...arrB.map((x) => x.createdAt || 0));
      return maxB - maxA;
    });
    return entries;
  }, [insigniasFiltradasLiga, temporadaAtiva]);

  function formatDate(ts?: number) {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      return d.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch {
      return '';
    }
  }

  const nowRef = Date.now();

  const lideratosFiltrados = useMemo(() => {
    return lideratos.filter((l) => (!ligaSelecionada ? true : (l.liga || '') === ligaSelecionada));
  }, [lideratos, ligaSelecionada]);

  const eliteMandatosFiltrados = useMemo(() => {
    return eliteMandatos.filter((m) => (!ligaSelecionada ? true : (m.liga || '') === ligaSelecionada));
  }, [eliteMandatos, ligaSelecionada]);

  const totalLeaderByGym = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const l of lideratosFiltrados) {
      const fim = l.fim ?? nowRef;
      const dur = Math.max(0, fim - (l.inicio || 0));
      acc[l.ginasio_id] = (acc[l.ginasio_id] || 0) + dur;
    }
    return acc;
  }, [lideratosFiltrados, nowRef]);

  const totalLeaderMs = useMemo(
    () => Object.values(totalLeaderByGym).reduce((a, b) => a + b, 0),
    [totalLeaderByGym]
  );

  const totalEliteByLiga = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const m of eliteMandatosFiltrados) {
      const fim = m.fim ?? nowRef;
      const dur = Math.max(0, fim - (m.inicio || 0));
      const key = m.liga || '—';
      acc[key] = (acc[key] || 0) + dur;
    }
    return acc;
  }, [eliteMandatosFiltrados, nowRef]);

  const totalEliteMs = useMemo(
    () => Object.values(totalEliteByLiga).reduce((a, b) => a + b, 0),
    [totalEliteByLiga]
  );

  function fmtDur(ms: number) {
    if (!ms || ms <= 0) return '0h';
    const daysTotal = Math.floor(ms / 86_400_000);
    const months = Math.floor(daysTotal / 30);
    const days = daysTotal % 30;
    const hours = Math.floor((ms % 86_400_000) / 3_600_000);
    if (months > 0) return `${months}m ${days}d`;
    if (days > 0) return `${days}d ${hours}h`;
    return `${hours}h`;
  }

  /* =======================
     Chat handlers
  ======================= */

  async function openDesafioChat(desafioId: string) {
    if (!logadoUid) return;
    chatUnsubRef.current?.();
    desafioUnsubRef.current?.();

    setChatOpen(true);
    setChatDesafioId(desafioId);
    setChatMsgs([]);
    setChatInput('');
    // zera o aviso a cada abertura
    setJaDeclarei(false);
    setJaDeclareiMsg(null);

    const dRef = doc(db, 'desafios_ginasio', desafioId);
    const dSnap = await getDoc(dRef);

    if (dSnap.exists()) {
      const d = dSnap.data() as any;

      const souLider = d.lider_uid === logadoUid;
      setSouLiderNoChat(souLider);

      const otherUid = souLider ? d.desafiante_uid : d.lider_uid;

      // resolve nome/FC do outro
      let nome = 'Treinador';
      let fc: string | null = null;
      try {
        const uSnap = await getDoc(doc(db, 'usuarios', otherUid));
        if (uSnap.exists()) {
          const ud = uSnap.data() as any;
          nome = ud.nome || ud.email || nome;
          fc = ud.friend_code || null;
        }
      } catch { /* ignora erro */ }
      setChatOtherName(nome);
      setChatOtherFC(fc);

      // verifica se EU já declarei resultado neste desafio
      const meuCampo = souLider ? 'resultado_lider' : 'resultado_desafiante';
      if (d[meuCampo]) {
        setJaDeclarei(true);
        setJaDeclareiMsg('Você já declarou um resultado para este desafio.');
      }
    }

    // mensagens em tempo real
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

    // doc do desafio em tempo real (fecha modal e atualiza flag "já declarei")
    desafioUnsubRef.current = onSnapshot(dRef, async (ds) => {
      if (!ds.exists()) return;
      const dd = ds.data() as any;

      if (dd.status === 'concluido' || dd.status === 'conflito') {
        await clearDesafioChat(desafioId);
        closeDesafioChat();
        return;
      }

      // mantenha o papel ALWAYS atualizado (caso mude no doc)
      const souLider = dd.lider_uid === logadoUid;
      setSouLiderNoChat(souLider);

      // compute e seta sem depender do valor anterior
      const meuCampo = souLider ? 'resultado_lider' : 'resultado_desafiante';
      const already = Boolean(dd[meuCampo]);
      setJaDeclarei(already);
      setJaDeclareiMsg(already ? 'Você já declarou um resultado para este desafio.' : null);
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
    if (!logadoUid || !chatDesafioId || !chatInput.trim()) return;
    await addDoc(collection(db, 'desafios_ginasio', chatDesafioId, 'mensagens'), {
      from: logadoUid,
      text: chatInput.trim(),
      createdAt: serverTimestamp(),
    });
    setChatInput('');
  }

  async function declareResultadoVenci() {
    if (jaDeclarei) { setJaDeclareiMsg('Você já declarou um resultado para este desafio.'); return; }

    if (!logadoUid || !chatDesafioId) return;
    const vencedor: 'lider' | 'desafiante' = souLiderNoChat ? 'lider' : 'desafiante';
    await handleDeclaracao(vencedor);
  }

  async function declareResultadoFuiDerrotado() {
    if (jaDeclarei) { setJaDeclareiMsg('Você já declarou um resultado para este desafio.'); return; }

    if (!logadoUid || !chatDesafioId) return;
    const vencedor: 'lider' | 'desafiante' = souLiderNoChat ? 'desafiante' : 'lider';
    await handleDeclaracao(vencedor);
  }

  async function handleDeclaracao(vencedor: 'lider' | 'desafiante') {
    setJaDeclarei(true);
    setJaDeclareiMsg('Você já declarou um resultado para este desafio.');

    try {
      const callerUid = auth.currentUser?.uid;
      if (!callerUid || !chatDesafioId) throw new Error('Sem sessão ou desafio');

      const actor: 'lider' | 'desafiante' = souLiderNoChat ? 'lider' : 'desafiante';

      const res = await setResultadoEFecharSePossivel(
        db,
        chatDesafioId!,
        actor,
        vencedor,
        callerUid
      );

      if (res.closed) {
        await clearDesafioChat(chatDesafioId);
        closeDesafioChat();
      }
    } catch (e) {
      console.error('Falha ao declarar resultado:', e);
      alert('Não foi possível declarar o resultado agora.');
      setJaDeclarei(false);
      setJaDeclareiMsg(null);
    }
  }


  async function clearDesafioChat(desafioId: string) {
    const snap = await getDocs(collection(db, 'desafios_ginasio', desafioId, 'mensagens'));
    await Promise.all(
      snap.docs.map((m) => deleteDoc(doc(db, 'desafios_ginasio', desafioId, 'mensagens', m.id)))
    );
  }

  /* =======================
     Usar PP para remover derrota (Wish)
  ======================= */

  async function handleUsarPPRemoverDerrota(g: Ginasio) {
    if (!ehMeuPerfil || !perfilUid) return;
    if ((g.derrotas_seguidas ?? 0) <= 0) { alert('Este ginásio não possui derrotas acumuladas.'); return; }
    if (!ppCustoWish || ppCustoWish <= 0) { alert('Configuração de custo de PP não encontrada.'); return; }

    try {
      setPpUsandoGinasioId(g.id);
      await runTransaction(db, async (tx) => {
        const userRef = doc(db, 'usuarios', perfilUid);
        const gymRef = doc(db, 'ginasios', g.id);
        const uSnap = await tx.get(userRef);
        const gSnap = await tx.get(gymRef);
        if (!uSnap.exists() || !gSnap.exists()) throw new Error('Dados indisponíveis');

        const ud = uSnap.data() as any;
        const gd = gSnap.data() as any;

        const total = Number(ud.pontosPresenca ?? 0);
        const consumidos = Number(ud.pontosPresencaConsumidos ?? ud.pp_consumidos ?? 0);
        const disponiveis = Math.max(0, total - consumidos);

        const rawUses: number = Number(ud.pp_wish_uses ?? 0);
        const storedSeasonId: string | null = ud.pp_wish_temporadaId ?? null;
        const activeSeasonId: string | null = temporadaAtiva?.id ?? null;
        const usesAtual = activeSeasonId && storedSeasonId === activeSeasonId ? Math.max(0, rawUses) : 0;

        const step = Number(ppUpWish ?? 0);
        const custo = computeWishCost(ppCustoWish, step, usesAtual);
        if (disponiveis < custo) throw new Error(`PP insuficiente (${disponiveis} < ${custo})`);

        const derrotasAtuais = Number(gd.derrotas_seguidas ?? 0);
        if (derrotasAtuais <= 0) throw new Error('Sem derrotas para remover');

        tx.update(userRef, {
          pp_consumidos: increment(custo),
          pp_wish_uses: usesAtual + 1,
          pp_wish_temporadaId: activeSeasonId ?? null,
        });
        tx.update(gymRef, { derrotas_seguidas: Math.max(0, derrotasAtuais - 1) });
      });

      // sinc local
      setUsuario((prev) => prev ? { ...prev, ppConsumidos: (prev.ppConsumidos ?? 0) + (custoWishComUp ?? 0), ppDisponiveis: Math.max(0, (prev.ppDisponiveis ?? 0) - (custoWishComUp ?? 0)) } : prev);
      setWishUses((u) => u + 1);
      setGinasiosLider((prev) => prev.map((x) => x.id === g.id ? { ...x, derrotas_seguidas: Math.max(0, (x.derrotas_seguidas ?? 0) - 1) } : x));
    } catch (e: any) {
      console.error(e);
      alert(e?.message || 'Não foi possível usar PP agora.');
    } finally {
      setPpUsandoGinasioId(null);
    }
  }

  /* =======================
   RENUNCIAR – FECHANDO MANDATO
======================= */

  async function handleRenunciar(g: Ginasio) {
    if (renunciando) return;
    setRenunciando(g.id);

    try {
      const now = Date.now();

      // Fechar mandatos abertos desse líder nesse ginásio
      if (g.lider_uid) {
        const qAberto = query(
          collection(db, 'ginasios_liderancas'),
          where('ginasio_id', '==', g.id),
          where('lider_uid', '==', g.lider_uid),
          where('fim', '==', null)
        );
        const snapAberto = await getDocs(qAberto);
        await Promise.all(snapAberto.docs.map((d) => updateDoc(d.ref, { fim: now })));
      }

      // Evita duplicar disputa: checa se já existe aberta
      const qExistente = query(
        collection(db, 'disputas_ginasio'),
        where('ginasio_id', '==', g.id),
        where('status', 'in', ['inscricoes', 'batalhando'])
      );
      const existe = await getDocs(qExistente);

      // Cria disputa diretamente se não existir uma aberta
      if (existe.empty) {
        await addDoc(collection(db, 'disputas_ginasio'), {
          ginasio_id: g.id,
          status: 'inscricoes',
          tipo_original: g.tipo || '',
          lider_anterior_uid: g.lider_uid || '',
          temporada_id: temporadaAtiva?.id || '',
          temporada_nome: temporadaAtiva?.nome || '',
          liga: g.liga || '',
          origem: 'renuncia',
          createdAt: now,
        });
      }

      // Atualiza ginásio: sem líder, em disputa, derrota resetada
      await updateDoc(doc(db, 'ginasios', g.id), {
        lider_uid: '',
        em_disputa: true,
        derrotas_seguidas: 0,
      });
      if (g.lider_uid) {
        await resetElite4PontuacaoDoUsuario(db, g.lider_uid, g.id, g.liga, 'renuncia');
      }
    } catch (e) {
      console.error('Falha ao renunciar:', e);
      alert('Não foi possível renunciar agora. Tente novamente.');
    } finally {
      setRenunciando(null);
    }
  }

  const displayName = usuario?.nome || usuario?.email || 'Jogador';

  /* =======================
     Render
  ======================= */

  if (loading) return <p className="p-6">Carregando...</p>;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Cabeçalho do perfil */}
      <div className="bg-white p-4 rounded shadow space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold truncate flex items-center gap-2">
              <span className="truncate">{displayName}</span>
              {usuario?.verificado && (
                <span
                  title="Usuário autenticado pela administração"
                  className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-[11px]"
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor">
                    <path d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Zm0 17.3c-3-1-5.5-4.3-5.5-7.7V6.7L12 5l5.5 1.7v4c0 3.4-2.5 6.7-5.5 7.6ZM11 14.6l-2.1-2.1.9-.9 1.2 1.2 3.3-3.3.9.9L11 14.6Z" />
                  </svg>
                  Verificado
                </span>
              )}
              {typeof usuario?.ppDisponiveis === 'number' && (
                <span className="text-xs sm:text-sm font-normal text-purple-700 whitespace-nowrap">
                  <b>PP:</b> {usuario.ppDisponiveis}
                </span>
              )}
            </h1>
            {usuario?.friend_code && (
              <p className="text-sm mt-1 break-all">Friend code: {usuario.friend_code}</p>
            )}
            <p className="text-xs text-gray-500 mt-1">
              Total de PP: {usuario?.pontosPresencaTotal ?? 0} · Consumidos: {usuario?.ppConsumidos ?? 0}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <div className="w-full sm:w-48">
              <label className="text-xs block mb-1 text-gray-500">Liga</label>
              <select
                value={ligaSelecionada}
                onChange={(e) => setLigaSelecionada(e.target.value)}
                className="w-full max-w-full border rounded px-2 py-1 text-sm"
              >
                <option value="">Todas</option>
                {ligas.map((l) => (
                  <option key={l.nome} value={l.nome}>
                    {l.nome}
                  </option>
                ))}
              </select>
            </div>

            <div className="w-full sm:w-56">
              <label className="text-xs block mb-1 text-gray-500">Temporada</label>
              <select
                value={temporadaSelecionada}
                onChange={(e) => setTemporadaSelecionada(e.target.value)}
                className="w-full max-w-full border rounded px-2 py-1 text-sm"
              >
                <option value="">Todas</option>
                {temporadas.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome || t.id}
                    {t.ativa ? ' (ativa)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push(`/equipes/${perfilUid}`)}
            className="bg-purple-600 text-white px-3 py-2 rounded text-sm"
          >
            Ver minhas equipes
          </button>
          <button
            onClick={() => router.push(`/tutorials`)}
            className="bg-purple-600 text-white px-3 py-2 rounded text-sm "
          >
            Ver tutorial
          </button>
        </div>
      </div>

      {/* ABAS */}
      <div className="bg-white rounded shadow">
        <nav className="flex flex-wrap gap-2 p-2 border-b">
          <TabButton id="insig_hist" active={tab === 'insig_hist'} onClick={setTab}>
            Insígnias & Histórico
          </TabButton>
          {ehMeuPerfil && (
            <TabButton id="desafios" active={tab === 'desafios'} onClick={setTab}>
              Desafios pendentes
            </TabButton>
          )}
          <TabButton id="ginasios" active={tab === 'ginasios'} onClick={setTab}>
            Ginásios
          </TabButton>
          <TabButton id="disputas" active={tab === 'disputas'} onClick={setTab}>
            Disputas que participa
          </TabButton>
        </nav>

        <div className="p-4 space-y-6">
          {/* TAB: INSÍGNIAS + HISTÓRICO */}
          {tab === 'insig_hist' && (
            <>
              {/* INSÍGNIAS */}
              <section>
                <h2 className="text-lg font-semibold mb-3">Insígnias</h2>

                {temporadaSelecionada ? (
                  insigniasFiltradasTemporada.length === 0 ? (
                    <p className="text-sm text-gray-500">Nenhuma insígnia nesta temporada.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {insigniasFiltradasTemporada
                        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
                        .map((ins) => (
                          <InsigniaCard
                            key={ins.id}
                            ins={ins}
                            TYPE_ICONS={TYPE_ICONS}
                            liderNomes={liderNomes}
                            temporadasMap={temporadasMap}
                            formatDate={formatDate}
                          />
                        ))}
                    </div>
                  )
                ) : (
                  <>
                    {gruposPorTemporada.length === 0 ? (
                      <p className="text-sm text-gray-500">Nenhuma insígnia conquistada ainda.</p>
                    ) : (
                      <div className="space-y-5">
                        {gruposPorTemporada.map(([tempId, arr]) => {
                          const titulo =
                            tempId === '__sem_temporada__'
                              ? 'Sem temporada'
                              : temporadasMap[tempId]?.nome || arr[0]?.temporada_nome || tempId;

                          return (
                            <div key={tempId}>
                              <h3 className="text-sm font-semibold text-gray-700 mb-2">{titulo}</h3>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {arr.map((ins) => (
                                  <InsigniaCard
                                    key={ins.id}
                                    ins={ins}
                                    TYPE_ICONS={TYPE_ICONS}
                                    liderNomes={liderNomes}
                                    temporadasMap={temporadasMap}
                                    formatDate={formatDate}
                                  />
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </section>

              {/* HISTÓRICO */}
              <section>
                <h2 className="text-lg font-semibold mb-2">Histórico</h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                  <div className="bg-gray-50 rounded p-3">
                    <p className="text-xs text-gray-500">Tempo total como Líder</p>
                    <p className="text-lg font-semibold">{fmtDur(totalLeaderMs)}</p>
                  </div>
                  <div className="bg-gray-50 rounded p-3">
                    <p className="text-xs text-gray-500">Tempo total como Elite 4</p>
                    <p className="text-lg font-semibold">{fmtDur(totalEliteMs)}</p>
                  </div>
                </div>

                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-1">Líder — por ginásio</h3>
                  {Object.keys(totalLeaderByGym).length === 0 ? (
                    <p className="text-xs text-gray-500">
                      Sem períodos de liderança registrados{ligaSelecionada ? ' nesta liga' : ''}.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {Object.entries(totalLeaderByGym)
                        .sort((a, b) => b[1] - a[1])
                        .map(([gId, ms]) => {
                          const nome = ginasiosMap[gId]?.nome || gId;
                          const liga = ginasiosMap[gId]?.liga || '';
                          return (
                            <li
                              key={gId}
                              className="flex items-center justify-between bg-gray-50 rounded px-3 py-2"
                            >
                              <div className="text-sm">
                                <p className="font-medium">{nome}</p>
                                {liga && <p className="text-xs text-gray-500">Liga: {liga}</p>}
                              </div>
                              <p className="text-sm font-semibold">{fmtDur(ms)}</p>
                            </li>
                          );
                        })}
                    </ul>
                  )}
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-1">Elite 4 — por liga</h3>
                  {Object.keys(totalEliteByLiga).length === 0 ? (
                    <p className="text-xs text-gray-500">
                      Sem períodos de Elite 4 registrados{ligaSelecionada ? ' nesta liga' : ''}.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {Object.entries(totalEliteByLiga)
                        .sort((a, b) => b[1] - a[1])
                        .map(([liga, ms]) => (
                          <li
                            key={liga}
                            className="flex items-center justify-between bg-gray-50 rounded px-3 py-2"
                          >
                            <p className="text-sm font-medium">{liga || '—'}</p>
                            <p className="text-sm font-semibold">{fmtDur(ms)}</p>
                          </li>
                        ))}
                    </ul>
                  )}
                </div>

                <p className="text-[11px] text-gray-400 mt-3">
                  Em breve: posições por campeonato e Hall of Fame com equipes usadas.
                </p>
              </section>
            </>
          )}

          {/* TAB: DESAFIOS PENDENTES */}
          {tab === 'desafios' && (
            <section className="bg-white">
              <h2 className="text-lg font-semibold mb-2">Desafios pendentes para você</h2>
              {!ehMeuPerfil ? (
                <p className="text-sm text-gray-500">Apenas o dono do perfil vê os desafios pendentes.</p>
              ) : desafiosComoLider.length === 0 ? (
                <p className="text-sm text-gray-500">Nenhum desafio pendente.</p>
              ) : (
                <div className="space-y-2">
                  {desafiosComoLider.map((d) => {
                    const gin = ginasiosMap[d.ginasio_id];
                    return (
                      <div
                        key={d.id}
                        className="flex justify-between items-center bg-gray-50 px-3 py-2 rounded"
                      >
                        <div>
                          <p className="text-sm">
                            {d.desafiante_nome || d.desafiante_uid} desafiou {gin ? gin.nome : d.ginasio_id}
                            {gin?.liga ? ` na liga ${gin.liga}` : ''}
                          </p>
                          <p className="text-xs text-gray-400">ID desafio: {d.id}</p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => openDesafioChat(d.id)}
                            className="bg-slate-800 text-white px-2 py-1 rounded text-xs"
                          >
                            Abrir chat
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* TAB: SEUS GINÁSIOS (visível para qualquer um; ações só para o dono) */}
          {tab === 'ginasios' && (
            <section className="space-y-3">
              <h2 className="text-xl font-semibold">
                {ehMeuPerfil ? 'Seus ginásios' : 'Ginásios do jogador'}
              </h2>

              {ginasiosFiltrados.length === 0 ? (
                <p className="text-sm text-gray-500">
                  {ligaSelecionada
                    ? (ehMeuPerfil
                      ? 'Você não é líder de ginásio nessa liga.'
                      : 'Este jogador não é líder nesta liga.')
                    : (ehMeuPerfil
                      ? 'Você não é líder de nenhum ginásio.'
                      : 'Este jogador não lidera nenhum ginásio.')}
                </p>
              ) : (
                ginasiosFiltrados.map((g) => (
                  <div
                    key={g.id}
                    onClick={!ehMeuPerfil ? () => router.push(`/ginasios/${g.id}`) : undefined}
                    className={`bg-white p-4 rounded shadow flex justify-between items-center gap-3 ${!ehMeuPerfil ? 'cursor-pointer hover:bg-gray-50' : ''
                      }`}
                  >
                    <div>
                      {/* Nome: clicável para visitante; texto puro para o dono */}
                      <p className="font-semibold">
                        {ehMeuPerfil ? (
                          g.nome
                        ) : (
                          <button
                            type="button"
                            onClick={() => router.push(`/ginasios/${g.id}`)}
                            className="text-left text-blue-700 hover:underline"
                          >
                            {g.nome}
                          </button>
                        )}
                      </p>

                      <p className="text-xs text-gray-400">{g.liga || 'Sem liga'}</p>

                      <p className="text-sm text-gray-500 flex items-center gap-2">
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

                      {/* Derrotas: só o dono vê */}
                      {ehMeuPerfil && (
                        <p className="text-xs text-gray-400">
                          Derrotas seguidas: {g.derrotas_seguidas ?? 0} / 3
                          {custoWishComUp != null && ' · Para se curar da derrota use Desejo'}
                        </p>
                      )}

                      {g.em_disputa && <p className="text-xs text-red-500">Em disputa</p>}
                    </div>

                    {ehMeuPerfil && (
                      <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2">
                        {custoWishComUp != null && (
                          <button
                            onClick={() => handleUsarPPRemoverDerrota(g)}
                            disabled={
                              ppUsandoGinasioId === g.id ||
                              (g.derrotas_seguidas ?? 0) <= 0 ||
                              (usuario?.ppDisponiveis ?? 0) < custoWishComUp
                            }
                            className="bg-yellow-500 text-white px-3 py-1 rounded text-xs disabled:opacity-50"
                          >
                            {ppUsandoGinasioId === g.id ? 'Aplicando...' : `Desejo -1 derrota (${custoWishComUp}PP)`}
                          </button>
                        )}

                        <button
                          onClick={() => handleRenunciar(g)}
                          disabled={renunciando === g.id}
                          className="bg-red-500 text-white px-3 py-1 rounded text-sm disabled:opacity-50"
                        >
                          {renunciando === g.id ? 'Renunciando...' : 'Renunciar'}
                        </button>

                        <Link
                          href={`/elite4/inscricao${g.liga ? `?liga=${encodeURIComponent(g.liga)}` : ''}`}
                          className="bg-purple-700 text-white px-3 py-1 rounded text-sm"
                        >
                          Elite 4
                        </Link>
                      </div>
                    )}
                  </div>
                ))
              )}
            </section>
          )}

          {/* TAB: DISPUTAS QUE PARTICIPA */}
          {tab === 'disputas' && (
            <section>
              <h2 className="text-lg font-semibold mb-2">Disputas que participa</h2>

              {/* CAMPEONATO / ELITE 4 */}
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-purple-700 mb-1">Campeonato / ELITE 4</h3>
                {eliteParts.filter((e) => !ligaSelecionada || e.liga === ligaSelecionada).length === 0 ? (
                  <p className="text-xs text-gray-500">Nenhuma participação em campeonato nesta liga.</p>
                ) : (
                  <ul className="space-y-2">
                    {eliteParts
                      .filter((e) => !ligaSelecionada || e.liga === ligaSelecionada)
                      .map((e) => (
                        <li
                          key={e.id}
                          className="flex justify-between items-center bg-purple-50 px-3 py-2 rounded"
                        >
                          <div>
                            <p className="text-sm font-medium">
                              Liga {e.liga} — {e.status === 'aberto' ? 'Em andamento' : 'Encerrado'}
                            </p>
                            <p className="text-xs text-gray-600">Pontos: {e.pontos}</p>
                          </div>
                          <Link
                            href={`/elite4/inscricao?liga=${encodeURIComponent(e.liga)}`}
                            className="bg-purple-700 text-white px-3 py-1 rounded text-sm"
                          >
                            Abrir
                          </Link>
                        </li>
                      ))}
                  </ul>
                )}
              </div>

              {/* DISPUTAS DE GINÁSIO */}
              {minhasInscricoes.length === 0 ? (
                <p className="text-sm text-gray-500">Nenhuma disputa de ginásio encontrada.</p>
              ) : (
                <ul className="space-y-2">
                  {minhasInscricoes.map((p) => (
                    <li
                      key={p.id}
                      className="flex justify-between items-center bg-gray-50 px-3 py-2 rounded"
                    >
                      <div>
                        <p className="text-sm font-medium">{p.ginasio_nome || p.ginasio_id}</p>
                        <p className="text-xs text-gray-500">Status: {p.disputa_status}</p>
                        {p.tipo_escolhido && (
                          <p className="text-xs text-gray-500 flex items-center gap-2">
                            Tipo:
                            {TYPE_ICONS[p.tipo_escolhido] && (
                              <Image
                                src={TYPE_ICONS[p.tipo_escolhido]}
                                alt={p.tipo_escolhido}
                                width={18}
                                height={18}
                              />
                            )}
                            <span>{p.tipo_escolhido}</span>
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => router.push(`/ginasios/${p.ginasio_id}/disputa`)}
                        className="bg-blue-600 text-white px-3 py-1 rounded text-sm"
                      >
                        Abrir
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </div>

      <button
        onClick={() => router.push('/jogadores')}
        className="bg-gray-200 text-gray-800 px-3 py-2 rounded text-sm"
      >
        Voltar
      </button>

      {/* Modal Chat */}
      {chatOpen && chatDesafioId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={closeDesafioChat} />
          <div className="relative bg-white w-full max-w-2xl rounded-xl shadow-xl p-4 md:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Desafio & Chat</h3>
                <p className="text-sm text-slate-600">Converse e finalize o resultado.</p>
              </div>
              <button className="text-slate-500 hover:text-slate-800 text-sm" onClick={closeDesafioChat}>
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
                          <Image
                            src={qrSrc(native)}
                            alt="QR para adicionar"
                            width={160}
                            height={160}
                            className="w-40 h-40 border rounded"
                          />
                          <button
                            onClick={() => (navigator as any)?.clipboard?.writeText?.(chatOtherFC!)}
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
                    const mine = m.from === logadoUid;
                    return (
                      <div
                        key={m.id}
                        className={`max-w-[85%] px-3 py-2 rounded ${mine ? 'self-end bg-blue-600 text-white' : 'self-start bg-white border'
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
              {jaDeclarei && (
                <div className="mt-2 rounded border border-amber-300 bg-amber-50 text-amber-800 text-sm px-3 py-2">
                  {jaDeclareiMsg || 'Você já declarou um resultado para este desafio.'}
                </div>
              )}

              <button
                onClick={declareResultadoVenci}
                disabled={jaDeclarei}
                className="w-full bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-green-700 text-white text-sm px-3 py-2 rounded"
                type="button"
              >
                🏆 Venci
              </button>

              <button
                onClick={declareResultadoFuiDerrotado}
                disabled={jaDeclarei}
                className="w-full bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-red-700 text-white text-sm px-3 py-2 rounded"
                type="button"
              >
                Fui derrotado
              </button>

            </div>
          </div>
        </div>
      )
      }
    </div >
  );
}

/* =======================
   Subcomponentes
======================= */

function TabButton({
  id,
  active,
  onClick,
  children,
}: {
  id: TabId;
  active: boolean;
  onClick: (id: TabId) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={() => onClick(id)}
      className={`px-3 py-2 rounded text-sm border ${active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 hover:bg-slate-100'
        }`}
      type="button"
    >
      {children}
    </button>
  );
}

function InsigniaCard({
  ins,
  TYPE_ICONS,
  liderNomes,
  temporadasMap,
  formatDate,
}: {
  ins: Insignia;
  TYPE_ICONS: Record<string, string>;
  liderNomes: Record<string, string>;
  temporadasMap: Record<string, Temporada>;
  formatDate: (ts?: number) => string;
}) {
  const tipo = ins.ginasio_tipo || '';
  const tipoIcon = tipo && TYPE_ICONS[tipo] ? TYPE_ICONS[tipo] : null;
  const temporadaNome = ins.temporada_nome || (ins.temporada_id ? temporadasMap[ins.temporada_id]?.nome : '');
  const liderNome = ins.lider_derrotado_uid ? liderNomes[ins.lider_derrotado_uid] || ins.lider_derrotado_uid : 'indisponível';

  return (
    <div className="flex items-center gap-3 bg-gray-50 rounded p-3">
      {ins.insignia_icon ? (
        <Image src={ins.insignia_icon} alt={ins.ginasio_nome || 'insígnia'} width={48} height={48} className="rounded" />
      ) : (
        <div className="w-12 h-12 bg-gray-300 rounded" />
      )}

      <div className="text-sm">
        <p className="font-semibold">{ins.ginasio_nome || ins.ginasio_id}</p>
        {ins.liga && <p className="text-xs text-gray-500">Liga: {ins.liga}</p>}
        {temporadaNome && <p className="text-xs text-gray-500">Temporada: {temporadaNome}</p>}

        <div className="mt-1 flex items-center gap-2 text-xs text-gray-600">
          <span>Tipo à época:</span>
          {tipoIcon && <Image src={tipoIcon} alt={tipo} width={16} height={16} />}
          <span>{tipo || '—'}</span>
        </div>

        <p className="text-xs text-gray-600">
          Líder à época: <span className="font-medium">{liderNome}</span>
        </p>

        {ins.createdAt ? (
          <p className="text-[11px] text-gray-400 mt-1">Conquistada em: {formatDate(ins.createdAt)}</p>
        ) : null}
      </div>
    </div>
  );
}
