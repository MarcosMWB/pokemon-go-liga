"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  getDoc,
  updateDoc,
  addDoc,
  getDocs,
  orderBy,
} from "firebase/firestore";
import { TYPE_ICONS } from "@/utils/typeIcons";
import Image from "next/image";

type Usuario = {
  id: string;
  nome?: string;
  email?: string;
  friend_code?: string;
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
};

type Liga = {
  nome: string;
};

export default function PerfilPage() {
  const params = useParams();
  const router = useRouter();
  const perfilUid = params?.id as string;

  const [logadoUid, setLogadoUid] = useState<string | null>(null);
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [ginasiosLider, setGinasiosLider] = useState<Ginasio[]>([]);
  const [minhasInscricoes, setMinhasInscricoes] = useState<DisputaParticipante[]>([]);
  const [desafiosComoLider, setDesafiosComoLider] = useState<Desafio[]>([]);
  const [temporada, setTemporada] = useState<{ id: string; nome?: string } | null>(null);
  const [insignias, setInsignias] = useState<Insignia[]>([]);
  const [ligas, setLigas] = useState<Liga[]>([]);
  const [ligaSelecionada, setLigaSelecionada] = useState<string>(""); // "" = todas
  const [loading, setLoading] = useState(true);

  // quem está logado
  useEffect(() => {
    const unsub = auth.onAuthStateChanged((user) => {
      if (user) setLogadoUid(user.uid);
    });
    return () => unsub();
  }, []);

  // carregar ligas
  useEffect(() => {
    (async () => {
      const snap = await getDocs(collection(db, "ligas"));
      const list: Liga[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return { id: d.id, nome: data.nome || d.id };
      });
      setLigas(list);
    })();
  }, []);

  // temporada ativa
  useEffect(() => {
    (async () => {
      try {
        const qTemp = query(collection(db, "temporadas"), where("ativa", "==", true));
        const snap = await getDocs(qTemp);
        if (!snap.empty) {
          const d = snap.docs[0];
          const data = d.data() as any;
          setTemporada({ id: d.id, nome: data.nome });
        }
      } catch (e) {
        console.warn("erro carregando temporada", e);
      }
    })();
  }, []);

  // dados do usuário do perfil
  useEffect(() => {
    if (!perfilUid) return;
    (async () => {
      try {
        const uSnap = await getDoc(doc(db, "usuarios", perfilUid));
        if (uSnap.exists()) {
          const d = uSnap.data() as any;
          setUsuario({
            id: perfilUid,
            nome: d.nome,
            email: d.email,
            friend_code: d.friend_code,
          });
        } else {
          setUsuario({ id: perfilUid });
        }
      } catch (e) {
        console.error("erro carregando usuário", e);
        setUsuario({ id: perfilUid });
      } finally {
        setLoading(false);
      }
    })();
  }, [perfilUid]);

  // ginásios que ele lidera
  useEffect(() => {
    if (!perfilUid) return;
    const qG = query(collection(db, "ginasios"), where("lider_uid", "==", perfilUid));
    const unsub = onSnapshot(qG, (snap) => {
      const list: Ginasio[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          nome: data.nome,
          tipo: data.tipo || "",
          lider_uid: data.lider_uid,
          derrotas_seguidas: data.derrotas_seguidas ?? 0,
          em_disputa: data.em_disputa ?? false,
          insignia_icon: data.insignia_icon || "",
          liga: data.liga || "",
        };
      });
      setGinasiosLider(list);
    });
    return () => unsub();
  }, [perfilUid]);

  // disputas que ele participa
  useEffect(() => {
    if (!perfilUid) return;

    const qP = query(
      collection(db, "disputas_ginasio_participantes"),
      where("usuario_uid", "==", perfilUid)
    );

    const unsub = onSnapshot(qP, (snap) => {
      (async () => {
        const enriched: DisputaParticipante[] = [];

        for (const docPart of snap.docs) {
          const data = docPart.data() as any;
          const disputaId = data.disputa_id;
          const ginasioId = data.ginasio_id;

          const dSnap = await getDoc(doc(db, "disputas_ginasio", disputaId));
          if (!dSnap.exists()) continue;
          const dData = dSnap.data() as any;
          if (dData.status === "finalizado") continue;

          let ginasio_nome: string | undefined = undefined;
          const gSnap = await getDoc(doc(db, "ginasios", ginasioId));
          if (gSnap.exists()) {
            const gData = gSnap.data() as any;
            ginasio_nome = gData.nome;
          }

          enriched.push({
            id: docPart.id,
            disputa_id: disputaId,
            ginasio_id: ginasioId,
            tipo_escolhido: data.tipo_escolhido,
            ginasio_nome,
            disputa_status: dData.status,
          });
        }

        setMinhasInscricoes(enriched);
      })();
    });

    return () => unsub();
  }, [perfilUid]);

  // desafios que ele precisa confirmar (como líder)
  useEffect(() => {
    if (!perfilUid) return;

    const qD = query(
      collection(db, "desafios_ginasio"),
      where("lider_uid", "==", perfilUid),
      where("status", "==", "pendente")
    );

    const unsub = onSnapshot(qD, async (snap) => {
      const list: Desafio[] = [];
      for (const d of snap.docs) {
        const data = d.data() as any;
        let desafiante_nome: string | undefined = undefined;
        const uSnap = await getDoc(doc(db, "usuarios", data.desafiante_uid));
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
        });
      }
      setDesafiosComoLider(list);
    });

    return () => unsub();
  }, [perfilUid]);

  // insígnias do jogador
  useEffect(() => {
    if (!perfilUid) return;
    const qIns = query(
      collection(db, "insignias"),
      where("usuario_uid", "==", perfilUid),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(qIns, (snap) => {
      const list: Insignia[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          ginasio_id: data.ginasio_id,
          ginasio_nome: data.ginasio_nome,
          ginasio_tipo: data.ginasio_tipo,
          insignia_icon: data.insignia_icon,
          temporada_id: data.temporada_id,
          temporada_nome: data.temporada_nome,
          liga: data.liga || "",
          createdAt: data.createdAt,
        };
      });
      setInsignias(list);
    });
    return () => unsub();
  }, [perfilUid]);

  const ehMeuPerfil = logadoUid === perfilUid;

  // líder disse que ganhou
  const handleLiderGanhou = async (desafio: Desafio) => {
    if (!ehMeuPerfil) return;

    const desafioRef = doc(db, "desafios_ginasio", desafio.id);

    await updateDoc(desafioRef, {
      resultado_lider: "lider",
    });

    const dSnap = await getDoc(desafioRef);
    const dData = dSnap.data() as any;
    const rd = dData.resultado_desafiante;

    if (!rd) return;

    if (rd === "lider") {
      // zera strikes
      await updateDoc(doc(db, "ginasios", desafio.ginasio_id), {
        derrotas_seguidas: 0,
      });

      await addDoc(collection(db, "bloqueios_ginasio"), {
        ginasio_id: desafio.ginasio_id,
        desafiante_uid: desafio.desafiante_uid,
        proximo_desafio: Date.now() + 7 * 24 * 60 * 60 * 1000,
      });

      await updateDoc(desafioRef, {
        status: "concluido",
      });
    } else {
      await updateDoc(desafioRef, {
        status: "conflito",
      });
      await addDoc(collection(db, "alertas_conflito"), {
        desafio_id: desafio.id,
        ginasio_id: desafio.ginasio_id,
        lider_uid: desafio.lider_uid,
        desafiante_uid: desafio.desafiante_uid,
        createdAt: Date.now(),
      });
    }
  };

  // líder disse que desafiante ganhou
  const handleDesafianteGanhou = async (desafio: Desafio) => {
    if (!ehMeuPerfil) return;

    const desafioRef = doc(db, "desafios_ginasio", desafio.id);

    await updateDoc(desafioRef, {
      resultado_lider: "desafiante",
    });

    const dSnap = await getDoc(desafioRef);
    const dData = dSnap.data() as any;
    const rd = dData.resultado_desafiante;

    if (!rd) return;

    if (rd === "desafiante") {
      const gRef = doc(db, "ginasios", desafio.ginasio_id);
      const gSnap = await getDoc(gRef);
      const gData = gSnap.exists() ? (gSnap.data() as any) : null;

      await addDoc(collection(db, "insignias"), {
        usuario_uid: desafio.desafiante_uid,
        ginasio_id: desafio.ginasio_id,
        ginasio_nome: gData?.nome || "",
        ginasio_tipo: gData?.tipo || "",
        lider_derrotado_uid: desafio.lider_uid,
        insignia_icon: gData?.insignia_icon || "",
        temporada_id: temporada?.id || "",
        temporada_nome: temporada?.nome || "",
        liga: gData?.liga || "",
        createdAt: Date.now(),
      });

      await addDoc(collection(db, "bloqueios_ginasio"), {
        ginasio_id: desafio.ginasio_id,
        desafiante_uid: desafio.desafiante_uid,
        proximo_desafio: Date.now() + 7 * 24 * 60 * 60 * 1000,
      });

      if (gSnap.exists()) {
        let derrotas = gData?.derrotas_seguidas ?? 0;
        derrotas += 1;
        if (derrotas >= 3) {
          await addDoc(collection(db, "disputas_ginasio"), {
            ginasio_id: desafio.ginasio_id,
            status: "inscricoes",
            tipo_original: gData?.tipo || "",
            lider_anterior_uid: gData?.lider_uid || "",
            temporada_id: temporada?.id || "",
            temporada_nome: temporada?.nome || "",
            liga: gData?.liga || "",
            createdAt: Date.now(),
          });

          await updateDoc(gRef, {
            lider_uid: "",
            em_disputa: true,
            derrotas_seguidas: 0,
          });
        } else {
          await updateDoc(gRef, {
            derrotas_seguidas: derrotas,
          });
        }
      }

      await updateDoc(desafioRef, {
        status: "concluido",
      });
    } else {
      await updateDoc(desafioRef, {
        status: "conflito",
      });
      await addDoc(collection(db, "alertas_conflito"), {
        desafio_id: desafio.id,
        ginasio_id: desafio.ginasio_id,
        lider_uid: desafio.lider_uid,
        desafiante_uid: desafio.desafiante_uid,
        createdAt: Date.now(),
      });
    }
  };

  if (loading) return <p className="p-6">Carregando...</p>;

  // aplicar filtro da liga nos ginásios onde ele é líder
  const ginasiosFiltrados = ginasiosLider.filter((g) => {
    if (!ligaSelecionada) return true;
    return (g.liga || "") === ligaSelecionada;
  });

  // aplicar filtro da liga nas insígnias
  const insigniasFiltradas = insignias.filter((ins) => {
    if (!ligaSelecionada) return true;
    return (ins.liga || "") === ligaSelecionada;
  });

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Cabeçalho */}
      <div className="bg-white p-4 rounded shadow space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">
              {usuario?.nome || usuario?.email || "Jogador"}
            </h1>
            <p className="text-sm text-gray-500">UID: {perfilUid}</p>
            {usuario?.friend_code && (
              <p className="text-sm mt-1">Friend code: {usuario.friend_code}</p>
            )}
          </div>
          <div>
            <label className="text-xs block mb-1 text-gray-500">
              Liga
            </label>
            <select
              value={ligaSelecionada}
              onChange={(e) => setLigaSelecionada(e.target.value)}
              className="border rounded px-2 py-1 text-sm"
            >
              <option value="">Todas</option>
              {ligas.map((l) => (
                <option key={l.nome} value={l.nome}>
                  {l.nome}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button
          onClick={() => router.push(`/equipes/${perfilUid}`)}
          className="bg-purple-600 text-white px-3 py-2 rounded text-sm"
        >
          Ver minhas equipes
        </button>
      </div>

      {/* área de líder */}
      {ehMeuPerfil && (
        <>
          <div className="space-y-3">
            <h2 className="text-xl font-semibold">Seus ginásios</h2>
            {ginasiosFiltrados.length === 0 ? (
              <p className="text-sm text-gray-500">
                {ligaSelecionada
                  ? "Você não é líder de ginásio nessa liga."
                  : "Você não é líder de nenhum ginásio."}
              </p>
            ) : (
              ginasiosFiltrados.map((g) => (
                <div
                  key={g.id}
                  className="bg-white p-4 rounded shadow flex justify-between items-center"
                >
                  <div>
                    <p className="font-semibold">{g.nome}</p>
                    <p className="text-xs text-gray-400">
                      {g.liga || g.liga || "Sem liga"}
                    </p>
                    <p className="text-sm text-gray-500 flex items-center gap-2">
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
                    <p className="text-xs text-gray-400">
                      Derrotas seguidas: {g.derrotas_seguidas ?? 0} / 3
                    </p>
                    {g.em_disputa && (
                      <p className="text-xs text-red-500">Em disputa</p>
                    )}
                  </div>
                  <button
                    onClick={async () => {
                      await addDoc(collection(db, "disputas_ginasio"), {
                        ginasio_id: g.id,
                        status: "inscricoes",
                        tipo_original: g.tipo || "",
                        lider_anterior_uid: g.lider_uid || "",
                        temporada_id: temporada?.id || "",
                        temporada_nome: temporada?.nome || "",
                        liga: g.liga || "",
                        createdAt: Date.now(),
                      });

                      await updateDoc(doc(db, "ginasios", g.id), {
                        lider_uid: "",
                        em_disputa: true,
                        derrotas_seguidas: 0,
                      });
                    }}
                    className="bg-red-500 text-white px-3 py-1 rounded text-sm"
                  >
                    Renunciar
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="bg-white p-4 rounded shadow">
            <h2 className="text-lg font-semibold mb-2">
              Desafios pendentes para você
            </h2>
            {desafiosComoLider.length === 0 ? (
              <p className="text-sm text-gray-500">Nenhum desafio pendente.</p>
            ) : (
              <div className="space-y-2">
                {desafiosComoLider.map((d) => (
                  <div
                    key={d.id}
                    className="flex justify-between items-center bg-gray-50 px-3 py-2 rounded"
                  >
                    <div>
                      <p className="text-sm">
                        {d.desafiante_nome || d.desafiante_uid} desafiou{" "}
                        {d.ginasio_id}
                      </p>
                      <p className="text-xs text-gray-400">ID desafio: {d.id}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleLiderGanhou(d)}
                        className="bg-green-600 text-white px-2 py-1 rounded text-xs"
                      >
                        Eu ganhei
                      </button>
                      <button
                        onClick={() => handleDesafianteGanhou(d)}
                        className="bg-yellow-500 text-white px-2 py-1 rounded text-xs"
                      >
                        Ele ganhou
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* disputas que participa */}
      <div className="bg-white p-4 rounded shadow">
        <h2 className="text-lg font-semibold mb-2">Disputas que participa</h2>
        {minhasInscricoes.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhuma disputa encontrada.</p>
        ) : (
          <ul className="space-y-2">
            {minhasInscricoes.map((p) => (
              <li
                key={p.id}
                className="flex justify-between items-center bg-gray-50 px-3 py-2 rounded"
              >
                <div>
                  <p className="text-sm font-medium">
                    {p.ginasio_nome || p.ginasio_id}
                  </p>
                  <p className="text-xs text-gray-500">
                    Status: {p.disputa_status}
                  </p>
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
                  onClick={() =>
                    router.push(`/ginasios/${p.ginasio_id}/disputa`)
                  }
                  className="bg-blue-600 text-white px-3 py-1 rounded text-sm"
                >
                  Abrir
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* INSÍGNIAS */}
      <div className="bg-white p-4 rounded shadow">
        <h2 className="text-lg font-semibold mb-3">Insígnias</h2>
        {insigniasFiltradas.length === 0 ? (
          <p className="text-sm text-gray-500">
            {ligaSelecionada
              ? "Nenhuma insígnia nessa liga."
              : "Nenhuma insígnia conquistada ainda."}
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {insigniasFiltradas.map((ins) => (
              <div
                key={ins.id}
                className="flex items-center gap-3 bg-gray-50 rounded p-2"
              >
                {ins.insignia_icon ? (
                  <Image
                    src={ins.insignia_icon}
                    alt={ins.ginasio_nome || "insígnia"}
                    width={48}
                    height={48}
                    className="rounded"
                  />
                ) : (
                  <div className="w-12 h-12 bg-gray-300 rounded" />
                )}
                <div className="text-sm">
                  <p className="font-semibold">
                    {ins.ginasio_nome || ins.ginasio_id}
                  </p>
                  {ins.liga && (
                    <p className="text-xs text-gray-500">{ins.liga}</p>
                  )}
                  {ins.temporada_nome && (
                    <p className="text-xs text-gray-500">
                      Temporada: {ins.temporada_nome}
                    </p>
                  )}
                  {ins.ginasio_tipo && TYPE_ICONS[ins.ginasio_tipo] && (
                    <Image
                      src={TYPE_ICONS[ins.ginasio_tipo]}
                      alt={ins.ginasio_tipo}
                      width={16}
                      height={16}
                      className="mt-1"
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* histórico / extra */}
      <div className="bg-white p-4 rounded shadow">
        <h2 className="text-lg font-semibold mb-2">Histórico de campeonatos</h2>
        <p className="text-sm text-gray-500">
          Aqui vão campeonatos, hall da fama, títulos.
        </p>
      </div>

      <button
        onClick={() => router.push("/jogadores")}
        className="bg-gray-200 text-gray-800 px-3 py-2 rounded text-sm"
      >
        Voltar
      </button>
    </div>
  );
}
