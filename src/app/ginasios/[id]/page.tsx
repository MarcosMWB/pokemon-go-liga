// src/app/ginasios/[id]/page.tsx
"use client";

import type { User } from "firebase/auth";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { auth, db } from "@/lib/firebase";
import { TYPE_ICONS } from "@/utils/typeIcons";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit as qLimit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  Unsubscribe,
} from "firebase/firestore";

/** ----------------- Tipos ----------------- */
type Ginasio = {
  id: string;
  nome: string;
  tipo?: string;
  liga?: string;
  lider_uid?: string; // "" quando vago
  em_disputa?: boolean;
  lat?: number;
  lng?: number;
  insignia_icon?: string;
};

type Usuario = {
  nome?: string;
  email?: string;
  friend_code?: string;
};

type Disputa = {
  id: string;
  ginasio_id: string;
  status: "inscricoes" | "batalhando" | "finalizado";
  liga?: string;
  liga_nome?: string;
  createdAt?: any;
};

type Lideranca = {
  id: string;
  ginasio_id: string;
  lider_uid: string | null;
  inicio: any;
  fim: any | null;
  origem?: "disputa" | "renuncia" | "3_derrotas" | "manual" | "empate";
  liga?: string;
  temporada_id?: string;
  temporada_nome?: string;
  tipo_no_periodo?: string;
};

type Desafio = {
  id: string;
  ginasio_id: string;
  lider_uid: string;
  desafiante_uid: string;
  status: "pendente" | "concluido" | "conflito";
  resultado_lider: "lider" | "desafiante" | null;
  resultado_desafiante: "lider" | "desafiante" | null;
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

type Insignia = {
  id: string;
  ginasio_id: string;
  temporada_id: string;
};

type Liga = { id: string; nome: string };

/** -------- util timestamps -------- */
function toMillis(v: any): number | null {
  if (!v) return null;
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "object" && "seconds" in v) {
    const sec = (v as any).seconds ?? 0;
    const ns = (v as any).nanoseconds ?? 0;
    return sec * 1000 + Math.floor(ns / 1e6);
  }
  return null;
}

function formatDate(ms: number | null) {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toLocaleString();
}

/** --------- Tipo badge --------- */
function TipoBadge({ tipo, size = 22 }: { tipo?: string; size?: number }) {
  if (!tipo) return <span className="text-xs text-gray-500">—</span>;
  const src = TYPE_ICONS[tipo];
  if (!src) return <span className="capitalize">{tipo}</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <Image src={src} alt={tipo} width={size} height={size} />
      <span className="capitalize">{tipo}</span>
    </span>
  );
}

/** ---- helpers sprites p/ preview de equipes (opcional) ---- */
function formatName(name: string) {
  return name
    .split("-")
    .map((w) => (w[0] ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
function slugifyBase(displayBase: string) {
  return displayBase
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.’'"]/g, "")
    .replace(/\./g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}
function suffixToToken(suf: string) {
  const s = suf.trim().toLowerCase();
  if (s === "alola") return "alola";
  if (s === "galar") return "galar";
  if (s === "hisui") return "hisui";
  if (s === "paldea") return "paldea";
  if (s === "hero") return "hero";
  if (s === "male") return "male";
  if (s === "female") return "female";
  if (s === "paldea combat") return "paldea-combat-breed";
  if (s === "paldea blaze") return "paldea-blaze-breed";
  if (s === "paldea aqua") return "paldea-aqua-breed";
  return s.replace(/\s+/g, "-");
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
          // fallback
        }
      }
      if (baseId) setSrc(officialArtworkById(baseId));
      else setSrc(null);
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
        if (baseId) setSrc(spriteMiniById(baseId));
        else setSrc(null);
      }}
    />
  );
}

/** ----------------- Página ----------------- */
export default function GinasioOverviewPage() {
  const params = useParams();
  const ginasioId = params?.id as string;

  const [uid, setUid] = useState<string | null>(null);

  // dados do ginásio e líder
  const [ginasio, setGinasio] = useState<Ginasio | null>(null);
  const [liderUser, setLiderUser] = useState<Usuario | null>(null);

  // disputa aberta
  const [disputaAberta, setDisputaAberta] = useState<Disputa | null>(null);

  // histórico de lideranças (UI informativa)
  const [historico, setHistorico] = useState<Array<Lideranca & { nome?: string }> | null>(null);

  // loading
  const [loading, setLoading] = useState(true);

  // temporada ativa (para regras de insígnia e participações/equipes)
  const [temporada, setTemporada] = useState<{ id: string; nome?: string } | null>(null);

  // estado do usuário neste ginásio
  const [bloqueio, setBloqueio] = useState<Bloqueio | null>(null);
  const [minhasInsignias, setMinhasInsignias] = useState<Insignia[]>([]);
  const [participacoesDisputa, setParticipacoesDisputa] = useState<
    { disputa_id: string; usuario_uid: string }[]
  >([]);

  // desafios ligados a este ginásio nos quais eu sou parte (como desafiante) e, se eu for líder, os dos meus desafiantes
  const [desafios, setDesafios] = useState<Desafio[]>([]);
  const [nomesUsuarios, setNomesUsuarios] = useState<Record<string, string>>({});
  const [ligas, setLigas] = useState<Liga[]>([]);
  const [nameToId, setNameToId] = useState<Record<string, number>>({});
  const [equipesUsuariosLiga, setEquipesUsuariosLiga] = useState<Record<string, string[]>>({});

  // seleção (se líder com múltiplos pendentes)
  const [desafioSelecionadoId, setDesafioSelecionadoId] = useState<string>("");

  // CHAT (mesmo modal e lógica da lista)
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDesafioId, setChatDesafioId] = useState<string | null>(null);
  const [chatMsgs, setChatMsgs] = useState<{ id: string; from: string; text: string; createdAt: any }[]>(
    []
  );
  const [chatInput, setChatInput] = useState("");
  const [chatOtherName, setChatOtherName] = useState("Treinador");
  const [chatOtherFC, setChatOtherFC] = useState<string | null>(null);
  const [souLiderNoChat, setSouLiderNoChat] = useState(false);
  const [showChatInfo, setShowChatInfo] = useState(false);
  const chatUnsubRef = useRef<Unsubscribe | null>(null);
  const desafioUnsubRef = useRef<Unsubscribe | null>(null);
  const chatBoxRef = useRef<HTMLDivElement | null>(null);

  const isAndroid =
    typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent || "");
  const qrSrc = (data: string) =>
    `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(data)}`;
  const buildPoGoFriendLinks = (fc: string) => {
    const native = `pokemongo://?dl_action=AddFriend&DlId=${encodeURIComponent(fc)}`;
    const androidIntent = `intent://?dl_action=AddFriend&DlId=${encodeURIComponent(
      fc
    )}#Intent;scheme=pokemongo;package=com.nianticlabs.pokemongo;end`;
    return { native, androidIntent };
  };

  useEffect(() => {
    if (chatOpen && chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [chatOpen, chatMsgs.length]);

  /** --------- Auth --------- */
  useEffect(() => {
    const unsub = auth.onAuthStateChanged((current: User | null) => {
      setUid(current?.uid ?? null);
    });
    return () => unsub();
  }, []);

  /** --------- Temporada ativa --------- */
  useEffect(() => {
    (async () => {
      const qTemp = query(collection(db, "temporadas"), where("ativa", "==", true));
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

  /** --------- Ligas (para mapear nomes → ids, caso mostre equipes) --------- */
  useEffect(() => {
    (async () => {
      const snap = await getDocs(collection(db, "ligas"));
      const list: Liga[] = snap.docs.map((d) => ({ id: d.id, nome: (d.data() as any).nome }));
      setLigas(list);
    })();
  }, []);

  /** --------- Dex base (nome → id) p/ preview dos times --------- */
  useEffect(() => {
    const fetchPokemonList = async () => {
      try {
        const res = await fetch("https://pokeapi.co/api/v2/pokemon?limit=1010");
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

  /** --------- Ginásio (live) + dados do líder --------- */
  useEffect(() => {
    if (!ginasioId) return;
    const unsub = onSnapshot(doc(db, "ginasios", ginasioId), async (snap) => {
      if (!snap.exists()) {
        setGinasio(null);
        setLiderUser(null);
        setLoading(false);
        return;
      }
      const d = snap.data() as any;
      const g: Ginasio = {
        id: snap.id,
        nome: d.nome || snap.id,
        tipo: d.tipo || "",
        liga: d.liga || d.liga_nome || "",
        lider_uid: d.lider_uid ?? "",
        em_disputa: d.em_disputa === true,
        lat: typeof d.lat === "number" ? d.lat : undefined,
        lng: typeof d.lng === "number" ? d.lng : undefined,
        insignia_icon: d.insignia_icon || "",
      };
      setGinasio(g);

      if (g.lider_uid) {
        try {
          const u = await getDoc(doc(db, "usuarios", g.lider_uid));
          if (u.exists()) {
            const du = u.data() as any;
            setLiderUser({
              nome: du.nome || du.email || g.lider_uid,
              email: du.email,
              friend_code: du.friend_code,
            });
          } else {
            setLiderUser({ nome: g.lider_uid });
          }
        } catch {
          setLiderUser({ nome: g.lider_uid });
        }
      } else {
        setLiderUser(null);
      }

      setLoading(false);
    });
    return () => unsub();
  }, [ginasioId]);

  /** --------- Disputa aberta (inscrições/batalhando) --------- */
  useEffect(() => {
    if (!ginasioId) return;
    const qDisp = query(
      collection(db, "disputas_ginasio"),
      where("ginasio_id", "==", ginasioId),
      where("status", "in", ["inscricoes", "batalhando"]),
      orderBy("createdAt", "desc"),
      qLimit(1)
    );
    const unsub = onSnapshot(qDisp, (snap) => {
      if (snap.empty) {
        setDisputaAberta(null);
      } else {
        const d = snap.docs[0].data() as any;
        setDisputaAberta({
          id: snap.docs[0].id,
          ginasio_id: d.ginasio_id,
          status: d.status,
          liga: d.liga,
          liga_nome: d.liga_nome,
          createdAt: d.createdAt,
        });
      }
    });
    return () => unsub();
  }, [ginasioId]);

  /** --------- Histórico de lideranças --------- */
  useEffect(() => {
    if (!ginasioId) return;
    const qHist = query(
      collection(db, "ginasios_liderancas"),
      where("ginasio_id", "==", ginasioId),
      orderBy("inicio", "desc"),
      qLimit(10)
    );
    const unsub = onSnapshot(qHist, async (snap) => {
      const base: Lideranca[] = snap.docs.map((d) => {
        const x = d.data() as any;
        return {
          id: d.id,
          ginasio_id: x.ginasio_id,
          lider_uid: x.lider_uid ?? null,
          inicio: x.inicio,
          fim: x.fim ?? null,
          origem: x.origem,
          liga: x.liga,
          temporada_id: x.temporada_id,
          temporada_nome: x.temporada_nome,
          tipo_no_periodo: x.tipo_no_periodo,
        };
      });

      const uniqUids = Array.from(
        new Set(base.map((b) => b.lider_uid).filter(Boolean)) as Set<string>
      );
      const nameMap = new Map<string, string>();
      await Promise.all(
        uniqUids.map(async (u) => {
          try {
            const us = await getDoc(doc(db, "usuarios", u));
            if (us.exists()) {
              const du = us.data() as any;
              nameMap.set(u, du.nome || du.email || u);
            } else {
              nameMap.set(u, u);
            }
          } catch {
            nameMap.set(u, u);
          }
        })
      );

      const withNames = base.map((b) => ({
        ...b,
        nome: b.lider_uid ? nameMap.get(b.lider_uid) : undefined,
      }));

      setHistorico(withNames);
    });
    return () => unsub();
  }, [ginasioId]);

  /** --------- Meu estado: bloqueio, insígnia, participação na disputa --------- */
  useEffect(() => {
    if (!uid || !ginasioId) return;

    // bloqueio para este ginásio
    const qBloq = query(
      collection(db, "bloqueios_ginasio"),
      where("desafiante_uid", "==", uid),
      where("ginasio_id", "==", ginasioId)
    );
    const un1 = onSnapshot(qBloq, (snap) => {
      const d = snap.docs[0];
      if (!d) {
        setBloqueio(null);
      } else {
        const x = d.data() as any;
        setBloqueio({
          id: d.id,
          ginasio_id: x.ginasio_id,
          desafiante_uid: x.desafiante_uid,
          proximo_desafio: x.proximo_desafio,
        });
      }
    });

    // minhas insígnias neste ginásio (p/ temporada ativa)
    const qIns = query(collection(db, "insignias"), where("usuario_uid", "==", uid));
    const un2 = onSnapshot(qIns, (snap) => {
      const list: Insignia[] = snap.docs.map((d) => {
        const x = d.data() as any;
        return { id: d.id, ginasio_id: x.ginasio_id, temporada_id: x.temporada_id || "" };
      });
      setMinhasInsignias(list);
    });

    // minha inscrição na disputa deste ginásio
    const un3 =
      disputaAberta?.id
        ? onSnapshot(
            query(
              collection(db, "disputas_ginasio_participantes"),
              where("disputa_id", "==", disputaAberta.id),
              where("usuario_uid", "==", uid)
            ),
            (snap) => {
              const list = snap.docs.map((d) => {
                const x = d.data() as any;
                return { disputa_id: x.disputa_id as string, usuario_uid: x.usuario_uid as string };
              });
              setParticipacoesDisputa(list);
            }
          )
        : () => {};

    return () => {
      un1();
      un2();
      un3();
    };
  }, [uid, ginasioId, disputaAberta?.id]);

  /** --------- Desafios relacionados a mim e a este ginásio --------- */
  useEffect(() => {
    if (!uid || !ginasioId) return;

    // como desafiante (meu desafio pendente nesse ginásio)
    const qDesafiante = query(
      collection(db, "desafios_ginasio"),
      where("ginasio_id", "==", ginasioId),
      where("desafiante_uid", "==", uid)
    );
    const un1 = onSnapshot(qDesafiante, (snap) => {
      const meus = snap.docs.map((d) => {
        const x = d.data() as any;
        return {
          id: d.id,
          ginasio_id: x.ginasio_id,
          liga: x.liga || "",
          lider_uid: x.lider_uid,
          desafiante_uid: x.desafiante_uid,
          status: x.status,
          resultado_lider: x.resultado_lider ?? null,
          resultado_desafiante: x.resultado_desafiante ?? null,
          createdAt: x.createdAt,
          disputa_id: x.disputa_id ?? null,
        } as Desafio;
      });
      setDesafios((prev) => {
        const outros = prev.filter((d) => !(d.desafiante_uid === uid && d.ginasio_id === ginasioId));
        return [...outros, ...meus];
      });
    });

    // se eu for o líder, ver pendentes endereçados a mim neste ginásio
    const qLider = query(
      collection(db, "desafios_ginasio"),
      where("ginasio_id", "==", ginasioId),
      where("lider_uid", "==", uid)
    );
    const un2 = onSnapshot(qLider, (snap) => {
      const meus = snap.docs.map((d) => {
        const x = d.data() as any;
        return {
          id: d.id,
          ginasio_id: x.ginasio_id,
          liga: x.liga || "",
          lider_uid: x.lider_uid,
          desafiante_uid: x.desafiante_uid,
          status: x.status,
          resultado_lider: x.resultado_lider ?? null,
          resultado_desafiante: x.resultado_desafiante ?? null,
          createdAt: x.createdAt,
          disputa_id: x.disputa_id ?? null,
        } as Desafio;
      });
      setDesafios((prev) => {
        const outros = prev.filter((d) => !(d.lider_uid === uid && d.ginasio_id === ginasioId));
        return [...outros, ...meus];
      });
    });

    return () => {
      un1();
      un2();
    };
  }, [uid, ginasioId]);

  /** --------- Carregar nomes dos desafiantes para UI --------- */
  useEffect(() => {
    (async () => {
      const ids = new Set<string>();
      desafios.forEach((d) => ids.add(d.desafiante_uid));
      const novos: Record<string, string> = {};
      for (const id of ids) {
        if (nomesUsuarios[id]) continue;
        try {
          const us = await getDoc(doc(db, "usuarios", id));
          if (us.exists()) {
            const du = us.data() as any;
            novos[id] = du.nome || du.email || id;
          } else {
            novos[id] = id;
          }
        } catch {
          novos[id] = id;
        }
      }
      if (Object.keys(novos).length) {
        setNomesUsuarios((p) => ({ ...p, ...novos }));
      }
    })();
  }, [desafios, nomesUsuarios]);

  /** --------- Ações / computados --------- */
  const agora = Date.now();
  const bloqueado = bloqueio ? bloqueio.proximo_desafio > agora : false;
  const jaTemInsignia =
    !!temporada &&
    minhasInsignias.some((i) => i.ginasio_id === ginasioId && i.temporada_id === temporada.id);

  const meusPendentesComoDesafiante = useMemo(
    () =>
      desafios.filter(
        (d) =>
          d.ginasio_id === ginasioId && d.desafiante_uid === uid && !d.disputa_id && d.status === "pendente"
      ),
    [desafios, ginasioId, uid]
  );

  const pendentesParaMimSeSouLider = useMemo(
    () =>
      desafios.filter(
        (d) =>
          d.ginasio_id === ginasioId && d.lider_uid === uid && !d.disputa_id && d.status === "pendente"
      ),
    [desafios, ginasioId, uid]
  );

  const jaNaDisputa =
    !!disputaAberta &&
    participacoesDisputa.some((p) => p.disputa_id === disputaAberta.id && p.usuario_uid === uid);

  const souLiderDesseGinasio = Boolean(ginasio?.lider_uid && uid && ginasio.lider_uid === uid);

  // Liga usada para mostrar equipe nesta tela
  const ligaParaEquipe = useMemo(() => {
    if (disputaAberta?.liga) return disputaAberta.liga;
    if (disputaAberta?.liga_nome) return disputaAberta.liga_nome!;
    if (ginasio?.liga) return ginasio.liga;

    if (meusPendentesComoDesafiante.length > 0 && meusPendentesComoDesafiante[0].liga) {
      return meusPendentesComoDesafiante[0].liga!;
    }

    if (souLiderDesseGinasio && pendentesParaMimSeSouLider.length > 0 && pendentesParaMimSeSouLider[0].liga) {
      return pendentesParaMimSeSouLider[0].liga!;
    }

    return ligas[0]?.nome || "";
  }, [
    disputaAberta?.liga,
    disputaAberta?.liga_nome,
    ginasio?.liga,
    meusPendentesComoDesafiante,
    pendentesParaMimSeSouLider,
    souLiderDesseGinasio,
    ligas,
  ]);

  // Carrega MINHA equipe para a liga do ginásio/disputa
  useEffect(() => {
    if (!uid || !temporada || !ligas.length || !ligaParaEquipe) return;

    const combo = `${uid}::${ligaParaEquipe}`;
    if (equipesUsuariosLiga[combo]) return;

    const ligasMap = new Map(ligas.map((l) => [l.nome, l.id]));
    const ligaId = ligasMap.get(ligaParaEquipe);
    if (!ligaId) return;

    (async () => {
      try {
        const partSnap = await getDocs(
          query(
            collection(db, "participacoes"),
            where("usuario_id", "==", uid),
            where("liga_id", "==", ligaId),
            where("temporada_id", "==", temporada.id)
          )
        );
        const partDoc = partSnap.docs[0];
        if (!partDoc) {
          setEquipesUsuariosLiga((p) => ({ ...p, [combo]: [] }));
          return;
        }
        const pokSnap = await getDocs(
          query(collection(db, "pokemon"), where("participacao_id", "==", partDoc.id))
        );
        const nomes = pokSnap.docs.map((p) => (p.data() as any).nome as string);
        setEquipesUsuariosLiga((p) => ({ ...p, [combo]: nomes }));
      } catch {
        setEquipesUsuariosLiga((p) => ({ ...p, [combo]: [] }));
      }
    })();
  }, [uid, temporada, ligas, ligaParaEquipe, equipesUsuariosLiga]);

  // pendentes alias + seleção automática (ANTES dos returns)
  const pendentes = pendentesParaMimSeSouLider;

  useEffect(() => {
    if (souLiderDesseGinasio && pendentesParaMimSeSouLider.length > 0 && !desafioSelecionadoId) {
      setDesafioSelecionadoId(pendentesParaMimSeSouLider[0].id);
    }
  }, [souLiderDesseGinasio, pendentesParaMimSeSouLider, desafioSelecionadoId]);

  // dSel computado (sem hook)
  const dSel =
    souLiderDesseGinasio
      ? (desafioSelecionadoId
          ? (pendentesParaMimSeSouLider.find((d) => d.id === desafioSelecionadoId) ?? null)
          : (pendentesParaMimSeSouLider[0] ?? null))
      : null;

  const equipeDesafianteSelecionado =
    dSel?.liga ? (equipesUsuariosLiga[`${dSel.desafiante_uid}::${dSel.liga}`] || []) : [];

  // carrega a equipe do desafiante selecionado (ANTES dos returns)
  useEffect(() => {
    if (!temporada || !ligas.length) return;
    if (!dSel?.liga) return;

    const combo = `${dSel.desafiante_uid}::${dSel.liga}`;
    if (equipesUsuariosLiga[combo]) return;

    (async () => {
      const ligasMap = new Map(ligas.map((l) => [l.nome, l.id]));
      const ligaId = ligasMap.get(dSel.liga!);
      if (!ligaId) return;

      try {
        const partSnap = await getDocs(
          query(
            collection(db, "participacoes"),
            where("usuario_id", "==", dSel.desafiante_uid),
            where("liga_id", "==", ligaId),
            where("temporada_id", "==", temporada.id)
          )
        );
        const partDoc = partSnap.docs[0];
        if (!partDoc) {
          setEquipesUsuariosLiga((p) => ({ ...p, [combo]: [] }));
          return;
        }
        const pokSnap = await getDocs(
          query(collection(db, "pokemon"), where("participacao_id", "==", partDoc.id))
        );
        const nomes = pokSnap.docs.map((p) => (p.data() as any).nome as string);
        setEquipesUsuariosLiga((p) => ({ ...p, [combo]: nomes }));
      } catch {
        setEquipesUsuariosLiga((p) => ({ ...p, [combo]: [] }));
      }
    })();
  }, [dSel, temporada, ligas, equipesUsuariosLiga]);

  const tipo = ginasio?.tipo || "";
  const hasDisputa = Boolean(disputaAberta);
  const liga = ginasio?.liga || disputaAberta?.liga_nome || disputaAberta?.liga || "";

  const minhaEquipeLiga =
    uid && ligaParaEquipe ? equipesUsuariosLiga[`${uid}::${ligaParaEquipe}`] || [] : [];

  const disputeCTAHref = useMemo(() => {
    if (!ginasio) return "#";
    const base = `/ginasios/${ginasio.id}/disputa`;
    if (disputaAberta?.status === "inscricoes") return `${base}?inscricao=1`;
    return base;
  }, [ginasio, disputaAberta?.status]);

  /** --------- Ações --------- */
  async function encerrarLideratoSeAberto(ginasioId: string, liderUid: string) {
    try {
      const qAberto = query(
        collection(db, "ginasios_liderancas"),
        where("ginasio_id", "==", ginasioId),
        where("lider_uid", "==", liderUid)
      );
      const snap = await getDocs(qAberto);
      const pendentes = snap.docs.filter((d) => {
        const x = d.data() as any;
        return x.fim === null || x.fim === undefined;
      });
      await Promise.all(
        pendentes.map((d) => updateDoc(doc(db, "ginasios_liderancas", d.id), { fim: Date.now() }))
      );
    } catch (e) {
      console.warn("Falha ao encerrar líderato aberto", e);
    }
  }

  async function handleDesafiar() {
    if (!uid || !ginasio || !ginasio.lider_uid) return;

    const existe = meusPendentesComoDesafiante.find((d) => d.ginasio_id === ginasio.id);
    if (existe) return;

    await addDoc(collection(db, "desafios_ginasio"), {
      ginasio_id: ginasio.id,
      liga: ginasio.liga || "",
      lider_uid: ginasio.lider_uid,
      desafiante_uid: uid,
      status: "pendente",
      resultado_lider: null,
      resultado_desafiante: null,
      createdAt: Date.now(),
      disputa_id: null,
    });
  }

  /** --------- Chat (mesma lógica) --------- */
  async function openDesafioChat(desafioId: string) {
    if (!uid) return;

    chatUnsubRef.current?.();
    desafioUnsubRef.current?.();

    const dRef = doc(db, "desafios_ginasio", desafioId);
    const dSnap = await getDoc(dRef);
    if (!dSnap.exists()) {
      alert("Desafio inexistente.");
      return;
    }
    const d = dSnap.data() as any;
    const souParticipante = d.lider_uid === uid || d.desafiante_uid === uid;
    if (!souParticipante) {
      alert("Você não participa deste desafio.");
      return;
    }

    setChatOpen(true);
    setChatDesafioId(desafioId);
    setChatMsgs([]);
    setChatInput("");
    setShowChatInfo(false);

    const otherUid = d.lider_uid === uid ? d.desafiante_uid : d.lider_uid;
    setSouLiderNoChat(d.lider_uid === uid);

    let nome = "Treinador";
    let fc: string | null = null;
    const uSnap = await getDoc(doc(db, "usuarios", otherUid));
    if (uSnap.exists()) {
      const ud = uSnap.data() as any;
      nome = ud.nome || ud.email || nome;
      fc = ud.friend_code || null;
    }
    setChatOtherName(nome);
    setChatOtherFC(fc);

    const msgsQ = query(
      collection(db, "desafios_ginasio", desafioId, "mensagens"),
      orderBy("createdAt", "asc")
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
        console.error("Chat listener error:", err);
        alert("Sem permissão para abrir este chat.");
        closeDesafioChat();
      }
    );

    desafioUnsubRef.current = onSnapshot(
      dRef,
      async (ds) => {
        if (!ds.exists()) return;
        const dd = ds.data() as any;
        if (dd.status === "concluido" || dd.status === "conflito") {
          await clearDesafioChat(desafioId);
          closeDesafioChat();
        }
      },
      (err) => console.error("Desafio listener error:", err)
    );
  }

  function closeDesafioChat() {
    chatUnsubRef.current?.();
    desafioUnsubRef.current?.();
    chatUnsubRefRefCleanup();
    setChatOpen(false);
    setChatDesafioId(null);
    setChatMsgs([]);
    setChatInput("");
    setChatOtherFC(null);
    setShowChatInfo(false);
  }
  function chatUnsubRefRefCleanup() {
    chatUnsubRef.current = null;
    desafioUnsubRef.current = null;
  }

  async function sendChatMessage() {
    if (!uid || !chatDesafioId || !chatInput.trim()) return;
    await addDoc(collection(db, "desafios_ginasio", chatDesafioId, "mensagens"), {
      from: uid,
      text: chatInput.trim(),
      createdAt: serverTimestamp(),
    });
    setChatInput("");
  }

  async function declareResultadoVenci() {
    await declareResultado(souLiderNoChat ? "lider" : "desafiante");
  }
  async function declareResultadoFuiDerrotado() {
    await declareResultado(souLiderNoChat ? "desafiante" : "lider");
  }

  async function declareResultado(vencedor: "lider" | "desafiante") {
    if (!uid || !chatDesafioId) return;
    const ref = doc(db, "desafios_ginasio", chatDesafioId);
    const dSnap = await getDoc(ref);
    if (!dSnap.exists()) return;
    const d = dSnap.data() as any;

    const souLider = d.lider_uid === uid;
    const campo = souLider ? "resultado_lider" : "resultado_desafiante";
    await updateDoc(ref, { [campo]: vencedor });
    await tentarFinalizarDesafio(ref);
  }

  async function clearDesafioChat(desafioId: string) {
    const snap = await getDocs(collection(db, "desafios_ginasio", desafioId, "mensagens"));
    await Promise.all(
      snap.docs.map((m) => deleteDoc(doc(db, "desafios_ginasio", desafioId, "mensagens", m.id)))
    );
  }

  async function tentarFinalizarDesafio(ref: any) {
    const dSnap = await getDoc(ref);
    const d = dSnap.data() as any;
    const rl = d.resultado_lider;
    const rd = d.resultado_desafiante;
    if (!rl || !rd) return;

    const gRef = doc(db, "ginasios", d.ginasio_id);
    const gSnap = await getDoc(gRef);
    const gData = gSnap.exists() ? (gSnap.data() as any) : null;

    if (rl === rd) {
      if (rl === "desafiante") {
        await addDoc(collection(db, "insignias"), {
          usuario_uid: d.desafiante_uid,
          ginasio_id: d.ginasio_id,
          ginasio_nome: gData?.nome || "",
          ginasio_tipo: gData?.tipo || "",
          lider_derrotado_uid: d.lider_uid,
          insignia_icon: gData?.insignia_icon || "",
          temporada_id: temporada?.id || "",
          temporada_nome: temporada?.nome || "",
          liga: gData?.liga || d.liga || "",
          createdAt: Date.now(),
        });

        await addDoc(collection(db, "bloqueios_ginasio"), {
          ginasio_id: d.ginasio_id,
          desafiante_uid: d.desafiante_uid,
          proximo_desafio: Date.now() + 7 * 24 * 60 * 60 * 1000,
        });

        if (gSnap.exists()) {
          let derrotas = gData?.derrotas_seguidas ?? 0;
          derrotas += 1;
          if (derrotas >= 3) {
            await addDoc(collection(db, "disputas_ginasio"), {
              ginasio_id: d.ginasio_id,
              status: "inscricoes",
              liga: gData?.liga || d.liga || "",
              tipo_original: gData?.tipo || "",
              lider_anterior_uid: gData?.lider_uid || "",
              temporada_id: temporada?.id || "",
              temporada_nome: temporada?.nome || "",
              origem: "3_derrotas",
              createdAt: Date.now(),
            });

            if (gData?.lider_uid) {
              await encerrarLideratoSeAberto(d.ginasio_id, gData.lider_uid);
            }

            await updateDoc(gRef, {
              lider_uid: "",
              em_disputa: true,
              derrotas_seguidas: 0,
            });
          } else {
            await updateDoc(gRef, { derrotas_seguidas: derrotas });
          }
        }
      } else {
        await updateDoc(gRef, { derrotas_seguidas: 0 });
        await addDoc(collection(db, "bloqueios_ginasio"), {
          ginasio_id: d.ginasio_id,
          desafiante_uid: d.desafiante_uid,
          proximo_desafio: Date.now() + 15 * 24 * 60 * 60 * 1000,
        });
      }

      await updateDoc(ref, { status: "concluido" });
      await clearDesafioChat(ref.id);
      closeDesafioChat();
    } else {
      await updateDoc(ref, { status: "conflito" });
      await addDoc(collection(db, "alertas_conflito"), {
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

  if (loading) return <p className="p-6">Carregando ginásio…</p>;
  if (!ginasio) {
    return (
      <div className="p-6">
        <p className="mb-4">Ginásio não encontrado.</p>
        <Link href="/ginasios" className="text-blue-600 underline">
          Voltar para a lista
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{ginasio.nome}</h1>
          <p className="text-sm text-gray-600 mt-1">
            Liga: <span className="font-medium">{liga || "—"}</span>
          </p>
          <p className="text-sm text-gray-600">
            Tipo: <TipoBadge tipo={tipo} />
          </p>
        </div>

        <div className="text-right">
          <Link href="/ginasios" className="text-sm text-blue-600 underline">
            Voltar
          </Link>
        </div>
      </div>

      {/* Cards superiores */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded shadow p-4">
          <h2 className="font-semibold mb-2">Líder atual</h2>
          {ginasio.lider_uid ? (
            <>
              <p className="text-sm">
                <Link
                  href={`/perfil/${ginasio.lider_uid}`}
                  className="text-blue-600 hover:underline"
                >
                  {liderUser?.nome || ginasio.lider_uid}
                </Link>
              </p>
              {liderUser?.friend_code && (
                <p className="text-xs text-gray-500 mt-1">FC: {liderUser.friend_code}</p>
              )}
            </>
          ) : (
            <p className="text-sm text-amber-700">Vago (sem líder)</p>
          )}
        </div>

        <div className="bg-white rounded shadow p-4">
          <h2 className="font-semibold mb-2">Status</h2>
          {hasDisputa ? (
            <p className="text-sm">
              Disputa aberta:{" "}
              <span className="font-medium">
                {disputaAberta!.status === "inscricoes" ? "inscrições" : "batalhando"}
              </span>
            </p>
          ) : (
            <p className="text-sm">{ginasio.em_disputa ? "Em disputa" : "Estável"}</p>
          )}
        </div>

        {/* AÇÃO */}
        <div className="bg-white rounded shadow p-4">
          <h2 className="font-semibold mb-2">Ação</h2>

          {hasDisputa ? (
            <>
              {disputaAberta!.status === "inscricoes" ? (
                <>
                  {jaNaDisputa ? (
                    <p className="text-xs text-gray-600 mb-2">Você já está inscrito.</p>
                  ) : null}
                  <Link
                    href={disputeCTAHref}
                    className="inline-block px-4 py-2 rounded bg-blue-600 text-white text-sm"
                  >
                    {jaNaDisputa ? "Ver disputa" : "Entrar na disputa (inscrever-se)"}
                  </Link>
                </>
              ) : (
                <Link
                  href={disputeCTAHref}
                  className="inline-block px-4 py-2 rounded bg-blue-600 text-white text-sm"
                >
                  Abrir disputa do ginásio
                </Link>
              )}
            </>
          ) : (
            <>
              {souLiderDesseGinasio ? (
                <>
                  {pendentes.length > 0 ? (
                    <div className="space-y-2">
                      <label className="text-xs text-gray-500">Desafios pendentes:</label>
                      <select
                        value={dSel?.id || ""}
                        onChange={(e) => setDesafioSelecionadoId(e.target.value)}
                        className="border rounded px-2 py-1 text-sm w-full"
                      >
                        {pendentes.map((d) => (
                          <option key={d.id} value={d.id}>
                            {nomesUsuarios[d.desafiante_uid] || d.desafiante_uid}
                          </option>
                        ))}
                      </select>

                      {dSel && equipeDesafianteSelecionado.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="text-xs text-gray-600">
                            Equipe de {nomesUsuarios[dSel.desafiante_uid] || dSel.desafiante_uid}:
                          </span>
                          <div className="flex -space-x-1">
                            {equipeDesafianteSelecionado.slice(0, 6).map((nome) => {
                              const baseName = nome.replace(/\s*\(.+\)\s*$/, "");
                              const baseId = nameToId[baseName];
                              return (
                                <PokemonMini key={nome} displayName={nome} baseId={baseId} size={24} />
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <button
                        onClick={() => dSel && openDesafioChat(dSel.id)}
                        className="w-full px-3 py-2 bg-slate-800 text-white rounded text-sm"
                      >
                        Abrir chat do desafio
                      </button>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-600">Nenhum desafio pendente.</p>
                  )}
                </>
              ) : meusPendentesComoDesafiante.length > 0 ? (
                <button
                  onClick={() => openDesafioChat(meusPendentesComoDesafiante[0].id)}
                  className="px-4 py-2 rounded bg-slate-800 text-white text-sm"
                >
                  Abrir chat do desafio
                </button>
              ) : (
                <button
                  onClick={handleDesafiar}
                  disabled={
                    !ginasio.lider_uid || ginasio.lider_uid === uid || bloqueado || jaTemInsignia
                  }
                  className="px-4 py-2 rounded bg-yellow-500 text-white text-sm disabled:opacity-50"
                >
                  {ginasio.lider_uid === uid
                    ? "Você é o líder"
                    : !ginasio.lider_uid
                    ? "Sem líder"
                    : jaTemInsignia
                    ? "Já ganhou na temporada"
                    : bloqueado
                    ? "Aguarde para desafiar"
                    : "Desafiar este ginásio"}
                </button>
              )}
            </>
          )}

          {ginasio.lat && ginasio.lng && (
            <div className="mt-2">
              <a
                href={`https://www.google.com/maps?q=${ginasio.lat},${ginasio.lng}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-600 underline"
              >
                Ver no mapa
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Preparação: Equipe × Tipo do ginásio */}
      <div className="bg-white rounded shadow p-4">
        <h2 className="font-semibold mb-3">Preparação (Equipe × Tipo do ginásio)</h2>

        {souLiderDesseGinasio ? (
          pendentes.length > 0 && dSel ? (
            <>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-600">
                    Desafiante: {nomesUsuarios[dSel.desafiante_uid] || dSel.desafiante_uid}
                  </span>
                  <div className="flex -space-x-1">
                    {equipeDesafianteSelecionado.slice(0, 6).map((nome) => {
                      const baseName = nome.replace(/\s*\(.+\)\s*$/, "");
                      const baseId = nameToId[baseName];
                      return <PokemonMini key={nome} displayName={nome} baseId={baseId} size={80} />;
                    })}
                  </div>
                </div>
                <div className="text-sm">
                  <h1 className="text-6xl font-bold">VS</h1> <span className="ml-2"><TipoBadge tipo={tipo} size={100}/></span>
                </div>
              </div>
              {equipeDesafianteSelecionado.length === 0 && (
                <p className="text-xs text-gray-500 mt-2">Time do desafiante não informado.</p>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-600">Sem desafiante selecionado.</p>
          )
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-600">
                  Sua equipe{ligaParaEquipe ? ` (${ligaParaEquipe})` : ""}:
                </span>
                <div className="flex -space-x-1">
                  {minhaEquipeLiga.slice(0, 6).map((nome) => {
                    const baseName = nome.replace(/\s*\(.+\)\s*$/, "");
                    const baseId = nameToId[baseName];
                    return <PokemonMini key={nome} displayName={nome} baseId={baseId} size={80} />;
                  })}
                </div>
              </div>
              <div className="text-sm">
                <h1 className="text-6xl font-bold">VS</h1> <span className="ml-2"><TipoBadge tipo={tipo} size={100}/></span>
              </div>
            </div>
            {minhaEquipeLiga.length === 0 && (
              <p className="text-xs text-gray-500 mt-2">
                Cadastre sua equipe na liga do ginásio para visualizar aqui.
              </p>
            )}
          </>
        )}
      </div>

      {/* Histórico */}
      <div className="bg-white rounded shadow p-4">
        <h2 className="font-semibold mb-3">Histórico recente de lideranças</h2>
        {!historico || historico.length === 0 ? (
          <p className="text-sm text-gray-500">Sem registros.</p>
        ) : (
          <ul className="space-y-2">
            {historico.map((h) => {
              const inicioMs = toMillis(h.inicio);
              const fimMs = toMillis(h.fim);
              return (
                <li
                  key={h.id}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between bg-gray-50 rounded px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{h.nome || h.lider_uid || "—"}</p>
                    <p className="text-xs text-gray-600">
                      Origem: {h.origem || "—"}
                      {h.tipo_no_periodo ? (
                        <>
                          {" · "}Tipo no período:{" "}
                          <span className="capitalize">{h.tipo_no_periodo}</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="text-xs text-gray-600 mt-1 sm:mt-0 sm:text-right">
                    <div>Início: {formatDate(inicioMs)}</div>
                    <div>Fim: {fimMs ? formatDate(fimMs) : "em curso/—"}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="text-xs text-gray-500">
        Dica: se houver inscrições abertas, use o botão “Entrar na disputa” para participar.
      </div>

      {/* Modal de Chat */}
      {chatOpen && chatDesafioId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={closeDesafioChat} />
          <div className="relative bg-white w-full max-w-2xl max-h-[90vh] rounded-xl shadow-xl p-3 md:p-5 flex flex-col">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Desafio & Chat</h3>
                <p className="text-xs text-slate-600">Combine a batalha e depois declare o resultado.</p>
              </div>
              <button className="text-slate-500 hover:text-slate-800 text-sm" onClick={closeDesafioChat}>
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
                      const { native, androidIntent } = buildPoGoFriendLinks(chatOtherFC!);
                      const deep = isAndroid ? androidIntent : native;
                      return (
                        <div className="mt-2 flex flex-col items-start gap-2">
                          <a href={deep} className="text-blue-600 text-xs hover:underline">
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
                              onClick={() => navigator.clipboard?.writeText(chatOtherFC!)}
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
                                <li>Se houver problema (app/conexão/atraso), registre aqui antes do resultado.</li>
                              </ul>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </>
                ) : (
                  <p className="text-xs text-amber-600 mt-1">O outro jogador não cadastrou FC.</p>
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
                    const mine = m.from === uid;
                    return (
                      <div
                        key={m.id}
                        className={`max-w-[85%] px-3 py-2 rounded text-xs ${
                          mine ? "self-end bg-blue-600 text-white" : "self-start bg-white border"
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
                  onKeyDown={(e) => e.key === "Enter" && sendChatMessage()}
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
