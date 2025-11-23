// src/app/dev/page.tsx
"use client";

import type { User } from "firebase/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  getDoc,
  getDocs,
} from "firebase/firestore";

export default function DevHome() {
  const router = useRouter();

  // gate de admin
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  // indicadores principais (ao vivo)
  const [openDisputas, setOpenDisputas] = useState(0); // disputas_ginasio: inscricoes/batalhando
  const [desafiosAbertos, setDesafiosAbertos] = useState(0); // desafios_ginasio: pendente/conflito

  // ginasios: calculamos tudo a partir de UM snapshot
  const [totalGinasios, setTotalGinasios] = useState(0);
  const [ginasiosEmDisputa, setGinasiosEmDisputa] = useState(0);
  const [ginasiosSemLider, setGinasiosSemLider] = useState(0);

  // ligas/temporadas (totais)
  const [totalLigas, setTotalLigas] = useState(0);
  const [totalTemporadas, setTotalTemporadas] = useState(0);

  // ========= AUTH + SUPERUSER =========
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (current: User | null) => {
      if (!current) {
        setIsAdmin(false);
        router.replace("/login");
        return;
      }

      // 1) superusers/{uid} (doc com id = uid)
      try {
        const d = await getDoc(doc(db, "superusers", current.uid));
        if (d.exists()) {
          setIsAdmin(true);
          return;
        }
      } catch {
        // segue para fallback
      }

      // 2) fallback: superusers com campo uid == current.uid
      try {
        const q = query(
          collection(db, "superusers"),
          where("uid", "==", current.uid)
        );
        const snap = await getDocs(q);
        setIsAdmin(!snap.empty);
        if (snap.empty) {
          router.replace("/");
        }
      } catch {
        setIsAdmin(false);
        router.replace("/");
      }
    });
    return () => unsub();
  }, [router]);

  // ========= SNAPSHOTS =========
  // disputas em aberto
  useEffect(() => {
    if (isAdmin !== true) return;
    const unsub = onSnapshot(
      query(
        collection(db, "disputas_ginasio"),
        where("status", "in", ["inscricoes", "batalhando"])
      ),
      (snap) => setOpenDisputas(snap.size)
    );
    return () => unsub();
  }, [isAdmin]);

  // desafios pendentes/conflito
  useEffect(() => {
    if (isAdmin !== true) return;
    const unsub = onSnapshot(
      query(
        collection(db, "desafios_ginasio"),
        where("status", "in", ["pendente", "conflito"])
      ),
      (snap) => setDesafiosAbertos(snap.size)
    );
    return () => unsub();
  }, [isAdmin]);

  // ginasios (um snapshot para todos os números de ginasio)
  useEffect(() => {
    if (isAdmin !== true) return;
    const unsub = onSnapshot(collection(db, "ginasios"), (snap) => {
      const total = snap.size;
      let emDisputa = 0;
      let semLider = 0;

      snap.forEach((d) => {
        const g = d.data() as any;
        if (g?.em_disputa === true) emDisputa += 1;

        // Sem líder: tratamos como “vazio” quando falsy ("" | null | undefined)
        if (!g?.lider_uid) semLider += 1;
      });

      setTotalGinasios(total);
      setGinasiosEmDisputa(emDisputa);
      setGinasiosSemLider(semLider);
    });
    return () => unsub();
  }, [isAdmin]);

  // ligas & temporadas (totais simples)
  useEffect(() => {
    if (isAdmin !== true) return;
    const unsubLigas = onSnapshot(collection(db, "ligas"), (snap) =>
      setTotalLigas(snap.size)
    );
    const unsubTemps = onSnapshot(collection(db, "temporadas"), (snap) =>
      setTotalTemporadas(snap.size)
    );
    return () => {
      unsubLigas();
      unsubTemps();
    };
  }, [isAdmin]);

  // tiles
  const statTiles = useMemo(
    () => [
      { label: "Disputas Abertas", value: openDisputas },
      { label: "Desafios Pend./Conflito", value: desafiosAbertos },
      { label: "Ginásios (total)", value: totalGinasios },
      { label: "Ginásios em disputa", value: ginasiosEmDisputa },
      { label: "Ginásios sem líder", value: ginasiosSemLider },
      { label: "Ligas (total)", value: totalLigas },
      { label: "Temporadas (total)", value: totalTemporadas },
    ],
    [
      openDisputas,
      desafiosAbertos,
      totalGinasios,
      ginasiosEmDisputa,
      ginasiosSemLider,
      totalLigas,
      totalTemporadas,
    ]
  );

  if (isAdmin === null) return <p className="p-6">Carregando…</p>;
  if (isAdmin === false) return null;

  return (
    <main className="max-w-6xl mx-auto p-6 space-y-8">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Painel Dev</h1>
          <p className="text-sm text-gray-500">
            Atalhos administrativos, contadores ao vivo e utilitários.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm text-blue-600 underline">
            Voltar ao site
          </Link>
        </div>
      </div>

      {/* Indicadores */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Indicadores</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
          {statTiles.map((t) => (
            <StatTile key={t.label} label={t.label} value={t.value} />
          ))}
        </div>
      </section>

      {/* Atalhos principais */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Operações</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Card
            title="Desafios (Jogador vs Líder)"
            href="/dev/desafios"
            badge={desafiosAbertos}
            subtitle="Pendentes / Conflitos"
          />
          <Card
            title="Disputas (Painel)"
            href="/dev/disputas"
            badge={openDisputas}
            subtitle="Inscrições / Batalha"
          />
          <Card
            title="Conflitos"
            href="/dev/conflitos"
            subtitle="Analisar alegações e atrasos"
          />
          <Card
            title="Gerenciar Ginásios"
            href="/dev/ginasios"
            badgeRightA={ginasiosEmDisputa}
            badgeRightATitle="em disputa"
            badgeRightB={ginasiosSemLider}
            badgeRightBTitle="sem líder"
          />
          <Card title="Gerenciar Ligas" href="/dev/ligas" />
          <Card title="Gerenciar Temporadas" href="/dev/temporadas" />
        </div>
      </section>

      {/* Campeonatos / Loja / Utilidades */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Extras & Utilidades</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Card
            title="Campeonato Elite 4"
            href="/dev/campeonato-elite4"
            subtitle="Chaves, fases e resultados"
          />
          <Card
            title="Seed de Ginásios"
            href="/dev/seed-ginasios"
            subtitle="Popular base de ginásios"
          />
          <Card title="Loja (DEV)" href="/dev/loja" />
          <Card
            title="PP & Consumos"
            href="/pp"
            subtitle="Pontos, custos e consumo"
          />
        </div>
      </section>
    </main>
  );
}

/* ================== UI ================== */

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border bg-white p-3 shadow-sm">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-800">{value}</div>
    </div>
  );
}

/** Card genérico com badges opcionais */
function Card(props: {
  title: string;
  href: string;
  subtitle?: string;
  badge?: number;
  badgeRightA?: number;
  badgeRightATitle?: string;
  badgeRightB?: number;
  badgeRightBTitle?: string;
}) {
  const {
    title,
    href,
    subtitle,
    badge,
    badgeRightA,
    badgeRightATitle,
    badgeRightB,
    badgeRightBTitle,
  } = props;

  return (
    <Link
      href={href}
      className="block bg-white rounded shadow p-4 hover:shadow-md transition"
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <h3 className="font-semibold truncate">{title}</h3>
          {subtitle && (
            <p className="text-xs text-gray-500 mt-1">{subtitle}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {typeof badge === "number" && (
            <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">
              {badge}
            </span>
          )}
          {typeof badgeRightA === "number" && (
            <span
              title={badgeRightATitle}
              className="text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700"
            >
              {badgeRightA}
            </span>
          )}
          {typeof badgeRightB === "number" && (
            <span
              title={badgeRightBTitle}
              className="text-xs px-2 py-0.5 rounded bg-orange-100 text-orange-700"
            >
              {badgeRightB}
            </span>
          )}
        </div>
      </div>

      <p className="text-sm text-blue-600 underline mt-3">Abrir</p>
    </Link>
  );
}
