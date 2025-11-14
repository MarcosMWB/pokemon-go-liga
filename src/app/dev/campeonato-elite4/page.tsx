"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

/** Tipos básicos */
type Liga = { id: string; nome: string };
type Campeonato = { id: string; liga: string; status: "aberto" | "fechado"; createdAt: number };
type Participante = {
  id: string;                // id do doc em campeonatos_elite4_participantes
  campeonato_id: string;
  usuario_uid: string;
  ginasio_id: string;
  pontos: number;
  nome?: string;
  ginasio_nome?: string;
};
type Elite4 = { id: string; liga: string; pos: 1 | 2 | 3 | 4; uid: string };
type Ginasio = { id: string; nome: string; liga?: string; lider_uid?: string };

/** Página */
export default function DevCampeonatoElite4() {
  const router = useRouter();

  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [ligas, setLigas] = useState<Liga[]>([]);
  const [ligaSel, setLigaSel] = useState<string>("");

  const [campeonato, setCampeonato] = useState<Campeonato | null>(null);
  const [participantes, setParticipantes] = useState<Participante[]>([]);
  const [elite4Atual, setElite4Atual] = useState<Record<number, Elite4 | undefined>>({});
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<string>("");

  /** Auth + superusers */
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (!user) { router.replace("/login"); return; }
      const sup = await getDocs(query(collection(db, "superusers"), where("uid", "==", user.uid)));
      if (sup.empty) { setIsAdmin(false); router.replace("/"); return; }
      setIsAdmin(true);
    });
    return () => unsub();
  }, [router]);

  /** Ligas */
  useEffect(() => {
    if (isAdmin !== true) return;
    (async () => {
      const snap = await getDocs(collection(db, "ligas"));
      const ls: Liga[] = snap.docs.map((d) => ({ id: d.id, nome: (d.data() as any).nome || d.id }));
      setLigas(ls);
      // evita depender de ligaSel
      setLigaSel((prev) => prev || ls[0]?.nome || "");
    })();
  }, [isAdmin]);

  /** Carrega/escuta campeonato aberto da liga selecionada */
  useEffect(() => {
    if (isAdmin !== true || !ligaSel) return;

    // campeonato aberto
    const qCamp = query(
      collection(db, "campeonatos_elite4"),
      where("liga", "==", ligaSel),
      where("status", "==", "aberto"),
      orderBy("createdAt", "desc")
    );
    const unsubCamp = onSnapshot(qCamp, (snap) => {
      if (snap.empty) { setCampeonato(null); setParticipantes([]); return; }
      const cDoc = snap.docs[0]; const d = cDoc.data() as any;
      setCampeonato({ id: cDoc.id, liga: d.liga, status: d.status, createdAt: d.createdAt });
    });

    // elite 4 atual dessa liga
    const qElite = query(collection(db, "elite4"), where("liga", "==", ligaSel));
    const unsubElite = onSnapshot(qElite, (snap) => {
      const map: Record<number, Elite4 | undefined> = {};
      snap.docs.forEach((dd) => {
        const data = dd.data() as any;
        if (data.pos >= 1 && data.pos <= 4) map[data.pos] = { id: dd.id, liga: data.liga, pos: data.pos, uid: data.uid };
      });
      setElite4Atual(map);
    });

    return () => { unsubCamp(); unsubElite(); };
  }, [isAdmin, ligaSel]);

  /** Participantes do campeonato aberto */
  useEffect(() => {
    if (!campeonato) return;
    const qPart = query(
      collection(db, "campeonatos_elite4_participantes"),
      where("campeonato_id", "==", campeonato.id)
    );
    const unsub = onSnapshot(qPart, async (snap) => {
      const base: Participante[] = [];
      for (const d of snap.docs) {
        const x = d.data() as any;
        const p: Participante = {
          id: d.id,
          campeonato_id: x.campeonato_id,
          usuario_uid: x.usuario_uid,
          ginasio_id: x.ginasio_id,
          pontos: x.pontos ?? 0,
        };
        // Nome do usuário
        const u = await getDoc(doc(db, "usuarios", p.usuario_uid));
        if (u.exists()) p.nome = (u.data() as any).nome || (u.data() as any).email || p.usuario_uid;
        // Nome do ginásio
        const g = await getDoc(doc(db, "ginasios", p.ginasio_id));
        if (g.exists()) p.ginasio_nome = (g.data() as any).nome || p.ginasio_id;
        base.push(p);
      }
      // compacta por líder (se por acaso liderar >1 ginásio, mantém a maior pontuação)
      const byUid = new Map<string, Participante>();
      base.forEach((p) => {
        const old = byUid.get(p.usuario_uid);
        if (!old || p.pontos > old.pontos) byUid.set(p.usuario_uid, p);
      });
      setParticipantes(Array.from(byUid.values()));
    });
    return () => unsub();
  }, [campeonato]);

  /** Funções */
  const criarCampeonato = async () => {
    if (!ligaSel) { setMsg("Selecione uma liga."); return; }
    setMsg(""); setSalvando(true);
    try {
      // cria doc campeonato
      const campRef = await addDoc(collection(db, "campeonatos_elite4"), {
        liga: ligaSel,
        status: "aberto",
        createdAt: Date.now(),
      });

      // coleta líderes atuais da liga (um por líder)
      const gs = await getDocs(query(collection(db, "ginasios"), where("liga", "==", ligaSel), where("lider_uid", "!=", "")));
      const seen = new Set<string>();
      for (const g of gs.docs) {
        const d = g.data() as any;
        const uid = d.lider_uid as string;
        if (!uid || seen.has(uid)) continue; // 1 por líder
        seen.add(uid);
        await addDoc(collection(db, "campeonatos_elite4_participantes"), {
          campeonato_id: campRef.id,
          usuario_uid: uid,
          ginasio_id: g.id,
          pontos: 0,
          createdAt: Date.now(),
        });
      }
      setMsg("Campeonato criado e participantes carregados.");
    } catch (e: any) {
      setMsg("Erro ao criar: " + e.message);
    } finally {
      setSalvando(false);
    }
  };

  const atualizarPontos = async (p: Participante, novo: number) => {
    setMsg("");
    await updateDoc(doc(db, "campeonatos_elite4_participantes", p.id), { pontos: novo });
  };

  const finalizarEPromover = async () => {
    if (!campeonato) { setMsg("Nenhum campeonato aberto."); return; }
    if (participantes.length < 4) { setMsg("Precisa de pelo menos 4 participantes."); return; }

    // ordena por pontos (desc) e pega top-4
    const ordenados = [...participantes].sort((a, b) => (b.pontos ?? 0) - (a.pontos ?? 0));
    const top4 = ordenados.slice(0, 4);

    if (!confirm(
      `Confirmar promoção para ELITE 4 da liga "${ligaSel}"?\n` +
      top4.map((p, i) => `${i + 1}º: ${p.nome} (${p.ginasio_nome})`).join("\n") +
      `\nLíderes promovidos deixam seus ginásios vagos e os antigos E4 assumem esses ginásios (mesma posição).`
    )) return;

    setSalvando(true); setMsg("");
    try {
      const batch = writeBatch(db);

      // carrega ginásios dos promovidos (uma vez)
      const gCache = new Map<string, Ginasio>();
      for (const p of top4) {
        const g = await getDoc(doc(db, "ginasios", p.ginasio_id));
        if (g.exists()) gCache.set(p.ginasio_id, { id: g.id, ...(g.data() as any) });
      }

      // aplica posição 1..4
      for (let pos = 1; pos <= 4; pos++) {
        const promoted = top4[pos - 1];
        const demoted = elite4Atual[pos];

        // 1) Atualiza/define ELITE 4 pos N
        const eliteDocId = demoted?.id || `${ligaSel}_pos${pos}`;
        batch.set(doc(db, "elite4", eliteDocId), {
          liga: ligaSel,
          pos,
          uid: promoted.usuario_uid,
          updatedAt: Date.now(),
        });

        // 2) Deixa o ginásio do promovido vago
        batch.update(doc(db, "ginasios", promoted.ginasio_id), {
          lider_uid: "",
          em_disputa: false,
          derrotas_seguidas: 0,
        });

        // 3) Se havia antigo E4 nessa posição, REBAIXA para o ginásio que ficou vago
        if (demoted?.uid) {
          batch.update(doc(db, "ginasios", promoted.ginasio_id), {
            lider_uid: demoted.uid,      // assume o ginásio do promovido
            em_disputa: false,
            derrotas_seguidas: 0,
          });
        }
      }

      // fecha o campeonato
      batch.update(doc(db, "campeonatos_elite4", campeonato.id), { status: "fechado", closedAt: Date.now() });

      // histórico simples
      await addDoc(collection(db, "campeonatos_elite4_resultados"), {
        campeonato_id: campeonato.id,
        liga: ligaSel,
        top4: top4.map((p, i) => ({ pos: i + 1, uid: p.usuario_uid, nome: p.nome || p.usuario_uid, ginasio_id: p.ginasio_id, ginasio_nome: p.ginasio_nome || p.ginasio_id, pontos: p.pontos })),
        appliedAt: Date.now(),
      });

      await batch.commit();
      setMsg("Promoções aplicadas com sucesso.");
    } catch (e: any) {
      setMsg("Erro ao aplicar promoções: " + e.message);
    } finally {
      setSalvando(false);
    }
  };

  const emAberto = Boolean(campeonato && campeonato.status === "aberto");

  const topPreview = useMemo(() => {
    return [...participantes].sort((a, b) => (b.pontos ?? 0) - (a.pontos ?? 0)).slice(0, 4);
  }, [participantes]);

  if (isAdmin === null) return <p className="p-6">Carregando…</p>;
  if (isAdmin === false) return null;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Campeonato dos Líderes → ELITE 4</h1>
          <p className="text-sm text-gray-500">
            Periodicamente, promova os 4 melhores líderes da liga selecionada para a ELITE 4.
            Os antigos E4 (mesmas posições) assumem os ginásios dos promovidos.
          </p>
        </div>
        <button onClick={() => router.push("/dev")} className="text-sm text-blue-600 underline">Voltar ao painel</button>
      </div>

      {msg && <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-sm">{msg}</div>}

      {/* Liga + estado */}
      <div className="bg-white p-4 rounded shadow flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Liga</label>
          <select
            value={ligaSel}
            onChange={(e) => setLigaSel(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          >
            {ligas.map(l => <option key={l.id} value={l.nome}>{l.nome}</option>)}
          </select>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {!emAberto ? (
            <button
              onClick={criarCampeonato}
              disabled={!ligaSel || salvando}
              className="px-3 py-2 rounded bg-blue-600 text-white text-sm disabled:opacity-50"
            >
              Criar campeonato (carregar líderes)
            </button>
          ) : (
            <>
              <span className="text-xs text-green-700 bg-green-100 px-2 py-1 rounded">Campeonato ABERTO</span>
              <button
                onClick={finalizarEPromover}
                disabled={salvando || participantes.length < 4}
                className="px-3 py-2 rounded bg-purple-700 text-white text-sm disabled:opacity-50"
              >
                Finalizar e promover (top-4)
              </button>
            </>
          )}
        </div>
      </div>

      {/* Elite 4 atual */}
      <div className="bg-white p-4 rounded shadow">
        <h2 className="text-lg font-semibold mb-2">ELITE 4 atual — {ligaSel || "—"}</h2>
        <ol className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {[1, 2, 3, 4].map((pos) => (
            <li key={pos} className="p-3 bg-gray-50 rounded flex justify-between items-center">
              <span className="text-sm">Posição {pos}</span>
              <span className="text-sm font-medium">
                {elite4Atual[pos]?.uid ? elite4Atual[pos]!.uid : "—"}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* Participantes e pontuação */}
      {emAberto && (
        <div className="bg-white p-4 rounded shadow">
          <h2 className="text-lg font-semibold mb-3">Participantes (líderes desta liga)</h2>
          {participantes.length === 0 ? (
            <p className="text-sm text-gray-500">Nenhum líder encontrado para esta liga.</p>
          ) : (
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 pr-3">Líder</th>
                    <th className="py-2 pr-3">Ginásio</th>
                    <th className="py-2 pr-3 w-32">Pontos</th>
                  </tr>
                </thead>
                <tbody>
                  {participantes
                    .sort((a, b) => (b.pontos ?? 0) - (a.pontos ?? 0))
                    .map((p) => (
                      <tr key={p.id} className="border-b">
                        <td className="py-2 pr-3">{p.nome || p.usuario_uid}</td>
                        <td className="py-2 pr-3">{p.ginasio_nome || p.ginasio_id}</td>
                        <td className="py-2 pr-3">
                          <input
                            type="number"
                            value={p.pontos ?? 0}
                            onChange={(e) => atualizarPontos(p, Number(e.target.value))}
                            className="w-24 border rounded px-2 py-1"
                          />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Pré-visualização do TOP-4 */}
      {emAberto && participantes.length > 0 && (
        <div className="bg-white p-4 rounded shadow">
          <h2 className="text-lg font-semibold mb-2">Pré-via do TOP-4</h2>
          <ol className="space-y-1">
            {topPreview.map((p, i) => (
              <li key={p.id} className="text-sm">
                {i + 1}º — <span className="font-medium">{p.nome || p.usuario_uid}</span>
                {" · "} {p.ginasio_nome || p.ginasio_id}
                {" · "} {p.pontos ?? 0} pts
              </li>
            ))}
          </ol>
          <p className="text-xs text-gray-500 mt-2">
            Ao finalizar, estes 4 assumem as posições 1–4 da ELITE 4.
            Os antigos E4 (se houver) assumem os ginásios dos promovidos.
          </p>
        </div>
      )}
    </div>
  );
}