// src/app/dev/ginasios/page.tsx
"use client";

import type { User } from "firebase/auth";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  getDocs,
  getDoc,
  query,
  where,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  writeBatch,
} from "firebase/firestore";

type Ginasio = {
  id: string;
  nome: string;
  tipo: string;
  lider_uid: string;
  em_disputa: boolean;
  liga?: string;
  liga_nome?: string;
};

type Disputa = {
  id: string;
  ginasio_id: string;
  status: "inscricoes" | "batalhando" | "finalizado";
  tipo_original?: string;
};

type Liga = { id: string; nome: string };
type Temporada = { id: string; nome?: string } | null;

type Renuncia = {
  id: string;
  ginasio_id: string;
  liga?: string;
  lider_uid: string;
  status: "pendente" | "confirmado" | "cancelado";
  motivo?: string;
  createdAtMs?: number | null;
};

type JobDisputa = {
  id: string;
  ginasio_id: string;
  disputa_id?: string;
  acao: "criar_disputa" | "iniciar_disputa" | "encerrar_disputa";
  runAtMs: number;
  status: "pendente" | "executado" | "erro" | "cancelado";
};


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

function tempoRelativo(ms?: number | null) {
  if (!ms) return "indeterminado";
  const diff = Date.now() - ms;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function formatCountdownFromNow(targetMs: number, nowMs: number) {
  const diff = targetMs - nowMs;
  if (diff <= 0) return "agora (ou já deveria ter rodado)";

  const totalSec = Math.floor(diff / 1000);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);

  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Fecha qualquer liderança ativa do ginásio (para registrar o término no histórico). */
async function endActiveLeadership(ginasioId: string) {
  const snap = await getDocs(
    query(
      collection(db, "ginasios_liderancas"),
      where("ginasio_id", "==", ginasioId),
      where("fim", "==", null)
    )
  );
  for (const d of snap.docs) {
    await updateDoc(d.ref, {
      fim: Date.now(),
      endedByAdminUid: auth.currentUser?.uid || null,
    });
  }
}

/** Inicia um novo período de liderança (para o perfil calcular “há quanto tempo”). */
async function startLeadership(
  ginasioId: string,
  leaderUid: string,
  meta?: {
    origem?: "disputa" | "renuncia" | "3_derrotas" | "manual";
    tipo?: string;
    temporada?: Temporada;
  }
) {
  let liga = "";
  let tipo = meta?.tipo || "";

  try {
    const gSnap = await getDoc(doc(db, "ginasios", ginasioId));
    if (gSnap.exists()) {
      const g = gSnap.data() as any;
      liga = g.liga || g.liga_nome || "";
      if (!tipo) tipo = g.tipo || "";
    }
  } catch { }

  await addDoc(collection(db, "ginasios_liderancas"), {
    ginasio_id: ginasioId,
    lider_uid: leaderUid,
    inicio: Date.now(),
    fim: null,
    origem: meta?.origem || "disputa",
    liga,
    tipo_no_periodo: tipo,
    temporada_id: meta?.temporada?.id || "",
    temporada_nome: meta?.temporada?.nome || "",
    createdByAdminUid: auth.currentUser?.uid || null,
    endedByAdminUid: null,
  });
}

/** Apaga todos os participantes de uma disputa (limpa inscrição antiga). */
async function deleteParticipantsOfDispute(disputaId: string) {
  const ps = await getDocs(
    query(
      collection(db, "disputas_ginasio_participantes"),
      where("disputa_id", "==", disputaId)
    )
  );

  await Promise.all(
    ps.docs.map(async (d) => {
      try {
        await deleteDoc(d.ref);
      } catch {
        // fallback se as rules não deixarem apagar: apenas "desativa"
        try {
          await updateDoc(d.ref, {
            removido: true,
            removidoPorAdminUid: auth.currentUser?.uid || null,
            removidoEm: Date.now(),
          });
        } catch {
          // mantém a execução mesmo assim
        }
      }
    })
  );
}

/** Fecha desafios pendentes do ginásio e limpa mensagens. */
async function closePendingChallengesOfGym(ginasioId: string) {
  try {
    const pend = await getDocs(
      query(
        collection(db, "desafios_ginasio"),
        where("ginasio_id", "==", ginasioId),
        where("status", "==", "pendente")
      )
    );
    for (const d of pend.docs) {
      try {
        await updateDoc(d.ref, {
          status: "concluido",
          fechadoPorAdminUid: auth.currentUser?.uid || null,
          fechadoEm: Date.now(),
        });
      } catch { }
      try {
        const msgs = await getDocs(
          collection(db, "desafios_ginasio", d.id, "mensagens")
        );
        await Promise.all(msgs.docs.map((m) => deleteDoc(m.ref)));
      } catch { }
    }
  } catch { }
}

export default function DevGinasiosPage() {
  const router = useRouter();

  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [ginasios, setGinasios] = useState<Ginasio[]>([]);
  const [disputas, setDisputas] = useState<Disputa[]>([]);
  const [ligas, setLigas] = useState<Liga[]>([]);
  const [ligaSelecionada, setLigaSelecionada] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const [temporada, setTemporada] = useState<Temporada>(null);
  const [renunciasMap, setRenunciasMap] = useState<Record<string, Renuncia>>({});
  const [jobs, setJobs] = useState<JobDisputa[]>([]);
  const [nowMs, setNowMs] = useState(Date.now());

  // ticker de 1s para o countdown
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // 1) auth + superusers (getDoc direto no doc {uid})
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (current: User | null) => {
      if (!current) {
        router.replace("/login");
        return;
      }
      const supSnap = await getDoc(doc(db, "superusers", current.uid));
      if (!supSnap.exists()) {
        setIsAdmin(false);
        router.replace("/");
        return;
      }
      setIsAdmin(true);
    });
    return () => unsub();
  }, [router]);

  // 2) carregar ligas
  useEffect(() => {
    if (isAdmin !== true) return;
    (async () => {
      const snap = await getDocs(collection(db, "ligas"));
      const list: Liga[] = snap.docs.map((d) => ({
        id: d.id,
        nome: (d.data() as any).nome || d.id,
      }));
      setLigas(list);
      if (list.length > 0) setLigaSelecionada(list[0].nome);
    })();
  }, [isAdmin]);

  // 2.1) temporada ativa
  useEffect(() => {
    if (isAdmin !== true) return;
    (async () => {
      const qTemp = query(
        collection(db, "temporadas"),
        where("ativa", "==", true)
      );
      const snap = await getDocs(qTemp);
      if (!snap.empty) {
        const d = snap.docs[0];
        const data = d.data() as any;
        setTemporada({ id: d.id, nome: data.nome });
      } else {
        setTemporada(null);
      }
    })();
  }, [isAdmin]);

  // 3) carregar ginasios + disputas + renúncias pendentes
  useEffect(() => {
    if (isAdmin !== true) return;

    async function loadAll() {
      try {
        const gSnap = await getDocs(collection(db, "ginasios"));
        const gList: Ginasio[] = gSnap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            nome: data.nome,
            tipo: data.tipo || "",
            lider_uid: data.lider_uid || "",
            em_disputa: data.em_disputa || false,
            liga: data.liga || data.liga_nome || "",
            liga_nome: data.liga_nome || data.liga || "",
          };
        });

        const dSnap = await getDocs(
          query(
            collection(db, "disputas_ginasio"),
            where("status", "in", ["inscricoes", "batalhando"])
          )
        );
        const dList: Disputa[] = dSnap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            ginasio_id: data.ginasio_id,
            status: data.status,
            tipo_original: data.tipo_original || "",
          };
        });

        const rSnap = await getDocs(
          query(
            collection(db, "renuncias_ginasio"),
            where("status", "==", "pendente")
          )
        );
        const map: Record<string, Renuncia> = {};
        rSnap.docs.forEach((dd) => {
          const x = dd.data() as any;
          const r: Renuncia = {
            id: dd.id,
            ginasio_id: x.ginasio_id,
            liga: x.liga || "",
            lider_uid: x.lider_uid,
            status: x.status || "pendente",
            motivo: x.motivo || "",
            createdAtMs: toMillis(x.createdAt),
          };
          const cur = map[r.ginasio_id];
          if (!cur || (r.createdAtMs || 0) > (cur.createdAtMs || 0))
            map[r.ginasio_id] = r;
        });

        setGinasios(gList);
        setDisputas(dList);
        setRenunciasMap(map);
      } finally {
        setLoading(false);
      }
    }

    loadAll();
  }, [isAdmin]);

  // 3.1) carregar jobs pendentes de disputa (para countdown)
  useEffect(() => {
    if (isAdmin !== true) return;
    (async () => {
      const snap = await getDocs(
        query(collection(db, "jobs_disputas"), where("status", "==", "pendente"))
      );
      const list: JobDisputa[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          ginasio_id: data.ginasio_id,
          disputa_id: data.disputa_id || undefined,
          acao: data.acao,
          runAtMs: data.runAtMs || 0,
          status: data.status || "pendente",
        };
      });
      setJobs(list);
    })();
  }, [isAdmin]);


  const getDisputaDoGinasio = (gId: string) =>
    disputas.find((d) => d.ginasio_id === gId);

  // agenda automaticamente jobs de iniciar/encerrar para uma disputa recém-criada
  const scheduleJobsForDisputa = async (
    g: Ginasio,
    disputaId: string,
    createdAtMs: number
  ) => {
    try {
      const vSnap = await getDoc(doc(db, "variables", "global"));
      if (!vSnap.exists()) return;

      const v = vSnap.data() as any;

      const tempoInscricoes =
        typeof v.tempo_inscricoes === "number"
          ? v.tempo_inscricoes
          : Number(v.tempo_inscricoes ?? 0);
      const tempoBatalhas =
        typeof v.tempo_batalhas === "number"
          ? v.tempo_batalhas
          : Number(v.tempo_batalhas ?? 0);

      const jobsToCreate: { acao: JobDisputa["acao"]; runAtMs: number }[] = [];

      if (tempoInscricoes > 0) {
        const battleStart = createdAtMs + tempoInscricoes * 60 * 60 * 1000;
        jobsToCreate.push({ acao: "iniciar_disputa", runAtMs: battleStart });
      }

      if (tempoBatalhas > 0) {
        const battleStart =
          tempoInscricoes > 0
            ? createdAtMs + tempoInscricoes * 60 * 60 * 1000
            : createdAtMs;
        const battleEnd = battleStart + tempoBatalhas * 60 * 60 * 1000;
        jobsToCreate.push({ acao: "encerrar_disputa", runAtMs: battleEnd });
      }

      if (!jobsToCreate.length) return;

      const now = Date.now();
      const createdByUid = auth.currentUser?.uid || null;
      const novosJobs: JobDisputa[] = [];

      for (const j of jobsToCreate) {
        const ref = await addDoc(collection(db, "jobs_disputas"), {
          ginasio_id: g.id,
          disputa_id: disputaId,
          acao: j.acao,
          runAtMs: j.runAtMs,
          status: "pendente",
          createdAt: now,
          createdByUid,
          liga: g.liga || g.liga_nome || "",
          tipo_original: g.tipo || "",
          origem: "auto_disputa",
        });

        novosJobs.push({
          id: ref.id,
          ginasio_id: g.id,
          disputa_id: disputaId,
          acao: j.acao,
          runAtMs: j.runAtMs,
          status: "pendente",
        });
      }

      if (novosJobs.length) {
        setJobs((prev) => [...prev, ...novosJobs]);
      }
    } catch (e) {
      console.error("Erro ao agendar jobs automáticos da disputa:", e);
    }
  };

  // quando o admin faz manualmente (criar/iniciar/encerrar), marcamos os jobs pendentes como executado
  const finalizeJobsForManualAction = async (
    ginasioId: string,
    acao: JobDisputa["acao"],
    disputaId?: string
  ) => {
    try {
      const snap = await getDocs(
        query(
          collection(db, "jobs_disputas"),
          where("ginasio_id", "==", ginasioId),
          where("status", "==", "pendente")
        )
      );

      const batch = writeBatch(db);
      let count = 0;

      snap.docs.forEach((jobDoc) => {
        const data = jobDoc.data() as any;
        if (data.acao !== acao) return;
        if (disputaId && data.disputa_id && data.disputa_id !== disputaId) return;

        batch.update(jobDoc.ref, {
          status: "executado",
          executadoPorAdminUid: auth.currentUser?.uid || null,
          executadoEm: Date.now(),
        });
        count++;
      });

      if (count > 0) {
        await batch.commit();

        setJobs((prev) =>
          prev.filter(
            (job) =>
              !(
                job.ginasio_id === ginasioId &&
                job.status === "pendente" &&
                job.acao === acao &&
                (!disputaId || job.disputa_id === disputaId)
              )
          )
        );
      }
    } catch (e) {
      console.error("Erro ao marcar jobs como executados manualmente:", e);
    }
  };

  // criar disputa manual
  // criar disputa manual
  const handleCriarDisputa = async (g: Ginasio) => {
    const ja = getDisputaDoGinasio(g.id);
    if (ja) return;

    // se existia job de criar_disputa pendente, marca como executado manualmente
    await finalizeJobsForManualAction(g.id, "criar_disputa");

    const nowMs = Date.now();

    const nova = await addDoc(collection(db, "disputas_ginasio"), {
      ginasio_id: g.id,
      status: "inscricoes",
      tipo_original: g.tipo || "",
      lider_anterior_uid: g.lider_uid || "",
      temporada_id: temporada?.id || "",
      temporada_nome: temporada?.nome || "",
      liga: g.liga || g.liga_nome || "",
      origem: "manual",
      createdAt: nowMs,
    });

    await updateDoc(doc(db, "ginasios", g.id), { em_disputa: true });

    setDisputas((prev) => [
      ...prev,
      {
        id: nova.id,
        ginasio_id: g.id,
        status: "inscricoes",
        tipo_original: g.tipo || "",
      },
    ]);
    setGinasios((prev) =>
      prev.map((gg) => (gg.id === g.id ? { ...gg, em_disputa: true } : gg))
    );

    // agenda automático: início e encerramento da disputa
    await scheduleJobsForDisputa(g, nova.id, nowMs);
  };

  async function hardDeleteDisputa(disputaId: string) {
    try {
      await deleteDoc(doc(db, "disputas_ginasio", disputaId));
    } catch {
      try {
        await updateDoc(doc(db, "disputas_ginasio", disputaId), {
          _softDeleted: true,
          _deletedAt: Date.now(),
          _deletedBy: auth.currentUser?.uid || null,
        });
      } catch { }
    }
  }


  // iniciar disputa (checa se há pelo menos 2 participantes válidos)
  const handleIniciarDisputa = async (g: Ginasio) => {
    const disputa = getDisputaDoGinasio(g.id);
    if (!disputa || disputa.status !== "inscricoes") return;

    // marca como removido quem não escolheu tipo
    const partSnap0 = await getDocs(
      query(
        collection(db, "disputas_ginasio_participantes"),
        where("disputa_id", "==", disputa.id)
      )
    );
    for (const pDoc of partSnap0.docs) {
      const d = pDoc.data() as any;
      if (!d.tipo_escolhido || d.tipo_escolhido === "") {
        await updateDoc(pDoc.ref, { removido: true });
      }
    }

    // reconta válidos (não-removido + com tipo_escolhido)
    const partSnap = await getDocs(
      query(
        collection(db, "disputas_ginasio_participantes"),
        where("disputa_id", "==", disputa.id)
      )
    );
    const validos = partSnap.docs
      .map((p) => p.data() as any)
      .filter((d) => !d.removido && d.tipo_escolhido && d.tipo_escolhido !== "")
      .length;

    if (validos < 2) {
      // não inicia; mantém período de inscrições
      return;
    }

    await updateDoc(doc(db, "disputas_ginasio", disputa.id), {
      status: "batalhando",
      iniciadaEm: Date.now(),
    });

    setDisputas((prev) =>
      prev.map((d) => (d.id === disputa.id ? { ...d, status: "batalhando" } : d))
    );

    await finalizeJobsForManualAction(g.id, "iniciar_disputa", disputa.id);
  };

  // encerrar disputa → registra liderança, apaga participantes e fecha desafios pendentes do ginásio
  const handleEncerrarDisputa = async (g: Ginasio) => {
    const disputa = getDisputaDoGinasio(g.id);
    if (!disputa) return;

    // 1) Carrega participantes válidos
    const partSnap = await getDocs(
      query(
        collection(db, "disputas_ginasio_participantes"),
        where("disputa_id", "==", disputa.id)
      )
    );
    const participantes = partSnap.docs
      .map((p) => {
        const d = p.data() as any;
        if (d.removido) return null;
        return {
          usuario_uid: d.usuario_uid as string,
          tipo_escolhido: d.tipo_escolhido as string,
        };
      })
      .filter(Boolean) as { usuario_uid: string; tipo_escolhido: string }[];

    // sem participantes válidos → finaliza sem vencedor
    if (participantes.length === 0) {
      await updateDoc(doc(db, "disputas_ginasio", disputa.id), {
        status: "finalizado",
        encerradaEm: Date.now(),
        vencedor_uid: "",
        finalizacao_aplicada: true,
      });

      await deleteParticipantsOfDispute(disputa.id);
      await updateDoc(doc(db, "ginasios", g.id), { em_disputa: false });
      await hardDeleteDisputa(disputa.id);

      setDisputas((prev) => prev.filter((d) => d.id !== disputa.id));
      setGinasios((prev) =>
        prev.map((gg) => (gg.id === g.id ? { ...gg, em_disputa: false } : gg))
      );

      await closePendingChallengesOfGym(g.id);
      await finalizeJobsForManualAction(g.id, "encerrar_disputa", disputa.id);
      return;
    }

    // 2) WO automático entre pares (resultado unilateral pendente)
    {
      const resSnapAll = await getDocs(
        query(
          collection(db, "disputas_ginasio_resultados"),
          where("disputa_id", "==", disputa.id)
        )
      );

      type ResultadoDoc = { id: string; data: any };
      const grupos: Record<string, ResultadoDoc[]> = {};

      resSnapAll.docs.forEach((rDoc) => {
        const d = rDoc.data() as any;

        if (d.tipo && String(d.tipo).toLowerCase() === "empate") return;

        const a = d.vencedor_uid as string | undefined;
        const b = d.perdedor_uid as string | undefined;
        if (!a || !b) return;

        const [x, y] = [a, b].sort();
        const key = `${x}__${y}`;

        if (!grupos[key]) grupos[key] = [];
        grupos[key].push({ id: rDoc.id, data: d });
      });

      const updates: Promise<void>[] = [];

      Object.values(grupos).forEach((lista) => {
        const pendentes = lista.filter(
          (r) => (r.data.status || "pendente") === "pendente"
        );
        const confirmados = lista.filter(
          (r) => r.data.status === "confirmado"
        );

        if (confirmados.length > 0) return;

        if (pendentes.length === 1) {
          const r = pendentes[0];
          updates.push(
            updateDoc(doc(db, "disputas_ginasio_resultados", r.id), {
              status: "confirmado",
              confirmadoPorWoAutomatico: true,
              confirmadoPorWoEm: Date.now(),
            }) as any
          );
        }
      });

      if (updates.length > 0) {
        await Promise.all(updates);
      }
    }

    // 3) Agora sim: resultados CONFIRMADOS para pontuar
    const resSnap = await getDocs(
      query(
        collection(db, "disputas_ginasio_resultados"),
        where("disputa_id", "==", disputa.id),
        where("status", "==", "confirmado")
      )
    );
    const resultados = resSnap.docs.map((r) => {
      const d = r.data() as any;
      return {
        vencedor_uid: d.vencedor_uid as string | undefined,
        perdedor_uid: d.perdedor_uid as string | undefined,
        tipo: d.tipo as string | undefined,
        jogador1_uid: d.jogador1_uid as string | undefined,
        jogador2_uid: d.jogador2_uid as string | undefined,
      };
    });

    const pontos: Record<string, number> = {};
    participantes.forEach((p) => (pontos[p.usuario_uid] = 0));

    resultados.forEach((r) => {
      if (r.tipo && r.tipo.toLowerCase() === "empate") {
        if (r.jogador1_uid)
          pontos[r.jogador1_uid] = (pontos[r.jogador1_uid] || 0) + 1;
        if (r.jogador2_uid)
          pontos[r.jogador2_uid] = (pontos[r.jogador2_uid] || 0) + 1;
      } else if (r.vencedor_uid) {
        pontos[r.vencedor_uid] = (pontos[r.vencedor_uid] || 0) + 3;
      }
    });

    let maior = -1;
    for (const uid in pontos) if (pontos[uid] > maior) maior = pontos[uid];
    const empatados = Object.keys(pontos).filter((uid) => pontos[uid] === maior);

    // protege contra estado externo (ginásio já com líder)
    const gFreshSnap = await getDoc(doc(db, "ginasios", g.id));
    const gFresh = gFreshSnap.exists() ? (gFreshSnap.data() as any) : null;

    if (gFresh?.lider_uid) {
      await updateDoc(doc(db, "disputas_ginasio", disputa.id), {
        status: "finalizado",
        encerradaEm: Date.now(),
        finalizacao_aplicada: true,
      });

      await deleteParticipantsOfDispute(disputa.id);
      await updateDoc(doc(db, "ginasios", g.id), { em_disputa: false });
      await hardDeleteDisputa(disputa.id);

      setDisputas((prev) => prev.filter((d) => d.id !== disputa.id));
      setGinasios((prev) =>
        prev.map((gg) => (gg.id === g.id ? { ...gg, em_disputa: false } : gg))
      );

      await closePendingChallengesOfGym(g.id);
      await finalizeJobsForManualAction(g.id, "encerrar_disputa", disputa.id);
      return;
    }

    // EMPATE → reabre nova disputa com empatados
    if (empatados.length > 1) {
      let novaId: string | null = null;

      try {
        const nowMs = Date.now();
        const nova = await addDoc(collection(db, "disputas_ginasio"), {
          ginasio_id: g.id,
          status: "inscricoes",
          tipo_original: disputa.tipo_original || g.tipo || "",
          lider_anterior_uid: g.lider_uid || "",
          reaberta_por_empate: true,
          temporada_id: temporada?.id || "",
          temporada_nome: temporada?.nome || "",
          liga: g.liga || g.liga_nome || "",
          origem: "empate",
          createdAt: nowMs,
        });
        novaId = nova.id;

        // agenda jobs automáticos para a nova disputa reaberta
        await scheduleJobsForDisputa(g, nova.id, nowMs);

        for (const uid of empatados) {
          try {
            const partOrig = participantes.find((p) => p.usuario_uid === uid);
            await addDoc(collection(db, "disputas_ginasio_participantes"), {
              disputa_id: nova.id,
              ginasio_id: g.id,
              usuario_uid: uid,
              tipo_escolhido:
                partOrig?.tipo_escolhido ||
                disputa.tipo_original ||
                g.tipo ||
                "",
              createdAt: Date.now(),
            });
          } catch (e) {
            console.warn("Seed de participante do empate falhou:", e);
          }
        }
      } finally {
        await updateDoc(doc(db, "disputas_ginasio", disputa.id), {
          status: "finalizado",
          encerradaEm: Date.now(),
          finalizacao_aplicada: true,
          vencedor_uid: null,
        });

        await deleteParticipantsOfDispute(disputa.id);
        await updateDoc(doc(db, "ginasios", g.id), { em_disputa: !!novaId });
        await hardDeleteDisputa(disputa.id);

        setDisputas((prev) => {
          const semAntiga = prev.filter((d) => d.id !== disputa.id);
          return novaId
            ? [
              ...semAntiga,
              {
                id: novaId,
                ginasio_id: g.id,
                status: "inscricoes",
                tipo_original: disputa.tipo_original || g.tipo || "",
              },
            ]
            : semAntiga;
        });

        setGinasios((prev) =>
          prev.map((gg) =>
            gg.id === g.id ? { ...gg, em_disputa: !!novaId } : gg
          )
        );

        await closePendingChallengesOfGym(g.id);
        await finalizeJobsForManualAction(g.id, "encerrar_disputa", disputa.id);
      }

      return;
    }

    // vencedor definido
    const vencedorUid = empatados[0];
    const participanteVencedor = participantes.find(
      (p) => p.usuario_uid === vencedorUid
    );
    const tipoDoVencedor =
      participanteVencedor?.tipo_escolhido ||
      (participanteVencedor as any)?.tipo ||
      disputa.tipo_original ||
      g.tipo ||
      "";

    await updateDoc(doc(db, "disputas_ginasio", disputa.id), {
      status: "finalizado",
      encerradaEm: Date.now(),
      vencedor_uid: vencedorUid,
      finalizacao_aplicada: true,
    });

    await endActiveLeadership(g.id);
    await startLeadership(g.id, vencedorUid, {
      origem: "disputa",
      tipo: tipoDoVencedor,
      temporada,
    });

    await updateDoc(doc(db, "ginasios", g.id), {
      lider_uid: vencedorUid,
      tipo: tipoDoVencedor,
      em_disputa: false,
    });

    await deleteParticipantsOfDispute(disputa.id);
    await hardDeleteDisputa(disputa.id);

    setDisputas((prev) => prev.filter((d) => d.id !== disputa.id));
    setGinasios((prev) =>
      prev.map((gg) =>
        gg.id === g.id
          ? {
            ...gg,
            em_disputa: false,
            lider_uid: vencedorUid,
            tipo: tipoDoVencedor,
          }
          : gg
      )
    );

    await closePendingChallengesOfGym(g.id);
    await finalizeJobsForManualAction(g.id, "encerrar_disputa", disputa.id);
  };

  // ===== RENÚNCIA
  const handleConfirmarRenuncia = async (g: Ginasio, r: Renuncia) => {
    const renRef = doc(db, "renuncias_ginasio", r.id);
    const disputaExistente = getDisputaDoGinasio(g.id);

    await endActiveLeadership(g.id);

    if (!disputaExistente) {
      const nowMs = Date.now();
      const nova = await addDoc(collection(db, "disputas_ginasio"), {
        ginasio_id: g.id,
        status: "inscricoes",
        tipo_original: g.tipo || "",
        lider_anterior_uid: g.lider_uid || r.lider_uid || "",
        temporada_id: temporada?.id || "",
        temporada_nome: temporada?.nome || "",
        liga: g.liga || g.liga_nome || r.liga || "",
        origem: "renuncia",
        createdAt: nowMs,
      });

      setDisputas((prev) => [
        ...prev,
        {
          id: nova.id,
          ginasio_id: g.id,
          status: "inscricoes",
          tipo_original: g.tipo || "",
        },
      ]);

      // agenda automático para essa disputa criada pela renúncia
      await scheduleJobsForDisputa(g, nova.id, nowMs);
    }

    await updateDoc(doc(db, "ginasios", g.id), {
      lider_uid: "",
      em_disputa: true,
      derrotas_seguidas: 0,
    });

    setGinasios((prev) =>
      prev.map((gg) =>
        gg.id === g.id ? { ...gg, lider_uid: "", em_disputa: true } : gg
      )
    );

    await updateDoc(renRef, {
      status: "confirmado",
      confirmadoPorAdminUid: auth.currentUser?.uid || null,
      confirmadoPorAdminEm: Date.now(),
    });

    await closePendingChallengesOfGym(g.id);

    setRenunciasMap((prev) => {
      const next = { ...prev };
      delete next[g.id];
      return next;
    });
  };

  const handleCancelarRenuncia = async (g: Ginasio, r: Renuncia) => {
    await updateDoc(doc(db, "renuncias_ginasio", r.id), {
      status: "cancelado",
      canceladoPorAdminUid: auth.currentUser?.uid || null,
      canceladoPorAdminEm: Date.now(),
    });
    setRenunciasMap((prev) => {
      const next = { ...prev };
      delete next[g.id];
      return next;
    });
  };

  const askHours = (label: string) => {
    const input = prompt(`Em quantas horas deseja ${label}?`, "1");
    if (!input) return null;
    const h = Number(input.replace(",", "."));
    if (isNaN(h) || h <= 0) {
      alert("Valor inválido. Use um número maior que zero.");
      return null;
    }
    return h;
  };

  const handleAgendarCriarDisputaCloud = async (g: Ginasio) => {
    const ja = getDisputaDoGinasio(g.id);
    if (ja) {
      alert("Este ginásio já tem disputa aberta.");
      return;
    }

    const h = askHours("CRIAR a disputa");
    if (h == null) return;

    const runAtMs = Date.now() + h * 60 * 60 * 1000;

    try {
      const ref = await addDoc(collection(db, "jobs_disputas"), {
        ginasio_id: g.id,
        acao: "criar_disputa",
        runAtMs,
        status: "pendente",
        createdAt: Date.now(),
        createdByUid: auth.currentUser?.uid || null,

        liga: g.liga || g.liga_nome || "",
        tipo_original: g.tipo || "",
        temporada_id: temporada?.id || "",
        temporada_nome: temporada?.nome || "",
        origem: "agendado_cloud",
      });

      setJobs((prev) => [
        ...prev,
        {
          id: ref.id,
          ginasio_id: g.id,
          acao: "criar_disputa",
          runAtMs,
          status: "pendente",
        },
      ]);

      alert(`Job criado: disputa será criada em ~${h} hora(s) (Cloud).`);
    } catch (e) {
      console.error(e);
      alert("Erro ao criar job de disputa (veja o console).");
    }
  };

  const handleAgendarIniciarDisputaCloud = async (g: Ginasio) => {
    const disputa = getDisputaDoGinasio(g.id);
    if (!disputa || disputa.status !== "inscricoes") {
      alert("Não há disputa em inscrições para iniciar.");
      return;
    }

    const h = askHours("INICIAR a disputa");
    if (h == null) return;

    const runAtMs = Date.now() + h * 60 * 60 * 1000;

    try {
      const ref = await addDoc(collection(db, "jobs_disputas"), {
        ginasio_id: g.id,
        disputa_id: disputa.id,
        acao: "iniciar_disputa",
        runAtMs,
        status: "pendente",
        createdAt: Date.now(),
        createdByUid: auth.currentUser?.uid || null,
        origem: "agendado_cloud",
      });

      setJobs((prev) => [
        ...prev,
        {
          id: ref.id,
          ginasio_id: g.id,
          acao: "iniciar_disputa",
          runAtMs,
          status: "pendente",
        },
      ]);

      alert(`Job criado: disputa será iniciada em ~${h} hora(s) (Cloud).`);
    } catch (e) {
      console.error(e);
      alert("Erro ao criar job de início de disputa (veja o console).");
    }
  };

  const handleCancelarJobsCloud = async (g: Ginasio) => {
    const ok = window.confirm(
      `Cancelar TODOS os agendamentos (Cloud) pendentes deste ginásio?`
    );
    if (!ok) return;

    try {
      const snap = await getDocs(
        query(
          collection(db, "jobs_disputas"),
          where("ginasio_id", "==", g.id),
          where("status", "==", "pendente")
        )
      );

      if (snap.empty) {
        alert("Nenhum agendamento pendente para este ginásio.");
        return;
      }

      const batch = writeBatch(db);
      snap.docs.forEach((jobDoc) => {
        batch.update(jobDoc.ref, {
          status: "cancelado",
          canceladoPorUid: auth.currentUser?.uid || null,
          canceladoEm: Date.now(),
        });
      });

      await batch.commit();

      setJobs((prev) =>
        prev.filter(
          (job) => !(job.ginasio_id === g.id && job.status === "pendente")
        )
      );

      alert(`Cancelado(s) ${snap.size} agendamento(s).`);
    } catch (e) {
      console.error(e);
      alert("Erro ao cancelar agendamentos (Cloud). Veja o console.");
    }
  };

  if (isAdmin === null || loading) return <p className="p-8">Carregando...</p>;
  if (isAdmin === false) return null;

  const ginasiosFiltrados = ginasios.filter((g) => {
    if (!ligaSelecionada) return true;
    const nomeLigaDoGinasio = g.liga_nome || g.liga || "";
    return nomeLigaDoGinasio === ligaSelecionada;
  });

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">DEV / Ginásios</h1>
          <p className="text-sm text-gray-500">
            Abrir / iniciar / encerrar disputas manualmente. Tratar renúncias
            pendentes.
          </p>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">
            Filtrar por liga
          </label>
          <select
            value={ligaSelecionada}
            onChange={(e) => setLigaSelecionada(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="">Todas</option>
            {ligas.map((l) => (
              <option key={l.id} value={l.nome}>
                {l.nome}
              </option>
            ))}
          </select>
        </div>
      </div>

      {ginasiosFiltrados.map((g) => {
        const disputa = getDisputaDoGinasio(g.id);
        const ren = renunciasMap[g.id];

        const jobsDoGinasio = jobs.filter(
          (job) => job.ginasio_id === g.id && job.status === "pendente"
        );
        const proximoJob =
          jobsDoGinasio.length === 0
            ? null
            : jobsDoGinasio.reduce<JobDisputa | null>((acc, job) => {
              if (!acc) return job;
              return job.runAtMs < acc.runAtMs ? job : acc;
            }, null);

        return (
          <div
            key={g.id}
            className="border rounded p-4 flex justify-between items-start bg-white gap-4"
          >
            <div>
              <h2 className="font-semibold flex items-center gap-2">
                {g.nome}
                {g.em_disputa && (
                  <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded">
                    em disputa
                  </span>
                )}
                {ren && (
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                    renúncia pendente
                  </span>
                )}
              </h2>
              <p className="text-sm text-gray-600">
                Líder: {g.lider_uid ? g.lider_uid : "vago"}
              </p>
              <p className="text-xs text-gray-500">
                Liga: {g.liga_nome || g.liga || "Sem liga"}
              </p>
              <p className="text-xs text-gray-500">
                Disputa: {disputa ? disputa.status : "nenhuma"}
              </p>

              {proximoJob && (
                <p className="text-[10px] text-gray-500 mt-1">
                  Próximo agendamento (
                  {proximoJob.acao === "criar_disputa"
                    ? "criar disputa"
                    : proximoJob.acao === "iniciar_disputa"
                      ? "iniciar disputa"
                      : "encerrar disputa"}
                  ): {formatCountdownFromNow(proximoJob.runAtMs, nowMs)} (
                  {new Date(proximoJob.runAtMs).toLocaleString("pt-BR")})
                </p>
              )}

              <Link
                href={`/ginasios/${g.id}/disputa`}
                className="text-xs text-blue-600 underline mt-1 inline-block"
              >
                Ver página da disputa
              </Link>

              {ren && (
                <div className="mt-2 text-xs text-gray-700">
                  <p>
                    Renúncia por {ren.lider_uid} · há{" "}
                    {tempoRelativo(ren.createdAtMs)}{" "}
                    {ren.motivo ? `· Motivo: ${ren.motivo}` : ""}
                  </p>
                  <p className="text-[10px] text-gray-400">ID renúncia: {ren.id}</p>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              {!disputa && (
                <>
                  <button
                    onClick={() => handleCriarDisputa(g)}
                    className="bg-purple-500 text-white px-3 py-1 rounded text-sm"
                  >
                    Criar disputa
                  </button>

                  <button
                    onClick={() => handleAgendarCriarDisputaCloud(g)}
                    className="bg-purple-200 text-purple-900 px-3 py-1 rounded text-sm"
                  >
                    Agendar criação (Cloud)
                  </button>
                </>
              )}

              {disputa && disputa.status === "inscricoes" && (
                <>
                  <button
                    onClick={() => handleIniciarDisputa(g)}
                    className="bg-orange-500 text-white px-3 py-1 rounded text-sm"
                  >
                    Iniciar disputa
                  </button>

                  <button
                    onClick={() => handleAgendarIniciarDisputaCloud(g)}
                    className="bg-orange-200 text-orange-900 px-3 py-1 rounded text-sm"
                  >
                    Agendar início (Cloud)
                  </button>
                </>
              )}

              {disputa && (
                <button
                  onClick={() => handleEncerrarDisputa(g)}
                  className="bg-gray-500 text-white px-3 py-1 rounded text-sm"
                >
                  Encerrar disputa
                </button>
              )}

              <button
                onClick={() => handleCancelarJobsCloud(g)}
                className="bg-red-200 text-red-900 px-3 py-1 rounded text-xs"
              >
                Cancelar agendamentos (Cloud)
              </button>

              {ren && (
                <>
                  <button
                    onClick={() => handleConfirmarRenuncia(g, ren)}
                    className="bg-blue-600 text-white px-3 py-1 rounded text-sm"
                    title="Confirmar renúncia, abrir disputa (se não existir) e limpar liderança"
                  >
                    Confirmar renúncia
                  </button>
                  <button
                    onClick={() => handleCancelarRenuncia(g, ren)}
                    className="bg-red-600 text-white px-3 py-1 rounded text-sm"
                    title="Cancelar a renúncia"
                  >
                    Cancelar renúncia
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
