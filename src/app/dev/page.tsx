// src/app/dev/page.tsx
"use client";

import type { User } from "firebase/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

export default function DevHome() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  // Contadores (ao vivo)
  const [openDisputas, setOpenDisputas] = useState(0);           // disputas_ginasio: inscricoes/batalhando
  const [desafiosAbertos, setDesafiosAbertos] = useState(0);     // desafios_ginasio: pendente/conflito
  const [ginasiosEmDisputa, setGinasiosEmDisputa] = useState(0); // ginasios: em_disputa == true
  const [ginasiosSemLider, setGinasiosSemLider] = useState(0);   // ginasios: lider_uid == ""

  // Auth + superusers
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (current: User | null) => {
      if (!current) {
        router.replace("/login");
        return;
      }
      const snap = await getDocs(
        query(collection(db, "superusers"), where("uid", "==", current.uid))
      );
      if (snap.empty) {
        setIsAdmin(false);
        router.replace("/");
        return;
      }
      setIsAdmin(true);
    });
    return () => unsub();
  }, [router]);

  // Snapshots de contadores
  useEffect(() => {
    if (isAdmin !== true) return;

    // disputas_ginasio abertas (inscricoes/batalhando)
    const unsub1 = onSnapshot(
      query(
        collection(db, "disputas_ginasio"),
        where("status", "in", ["inscricoes", "batalhando"])
      ),
      (snap) => setOpenDisputas(snap.size)
    );

    // desafios_ginasio pendentes ou em conflito
    const unsub2 = onSnapshot(
      query(
        collection(db, "desafios_ginasio"),
        where("status", "in", ["pendente", "conflito"])
      ),
      (snap) => setDesafiosAbertos(snap.size)
    );

    // ginasios em disputa
    const unsub3 = onSnapshot(
      query(collection(db, "ginasios"), where("em_disputa", "==", true)),
      (snap) => setGinasiosEmDisputa(snap.size)
    );

    // ginasios sem líder (campo vazio)
    const unsub4 = onSnapshot(
      query(collection(db, "ginasios"), where("lider_uid", "==", "")),
      (snap) => setGinasiosSemLider(snap.size)
    );

    return () => {
      unsub1();
      unsub2();
      unsub3();
      unsub4();
    };
  }, [isAdmin]);

  if (isAdmin === null) return <p className="p-6">Carregando…</p>;
  if (isAdmin === false) return null;

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Painel Dev</h1>
          <p className="text-sm text-gray-500">
            Atalhos administrativos e visão rápida de status.
          </p>
        </div>
        <button
          onClick={() => router.push("/")}
          className="text-sm text-blue-600 underline"
        >
          Voltar ao site
        </button>
      </div>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Desafios (Jogador vs Líder) */}
        <Card
          title="Desafios (Jogador vs Líder)"
          href="/dev/desafios"
          badge={desafiosAbertos}
          subtitle="Pendentes/Conflitos"
        />

        {/* Disputas (painel geral) */}
        <Card
          title="Disputas (Painel)"
          href="/dev/disputas"
          badge={openDisputas}
          subtitle="Abertas (inscrições/batalha)"
        />

        {/* Conflitos */}
        <Card
          title="Conflitos"
          href="/dev/conflitos"
          subtitle="Analisar alegações e atrasos"
        />

        {/* Ginásios */}
        <Card
          title="Gerenciar Ginásios"
          href="/dev/ginasios"
          badgeRightA={ginasiosEmDisputa}
          badgeRightATitle="em disputa"
          badgeRightB={ginasiosSemLider}
          badgeRightBTitle="sem líder"
        />

        {/* Ligas */}
        <Card title="Gerenciar Ligas" href="/dev/ligas" />

        {/* Temporadas */}
        <Card title="Gerenciar Temporadas" href="/dev/temporadas" />

        {/* Seed de ginásios */}
        <Card title="Seed de Ginásios" href="/dev/seed-ginasios" />

        {/* Loja (dropshipping) */}
        <Card title="Loja (DEV)" href="/dev/loja" />
      </section>
    </main>
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
        <div>
          <h3 className="font-semibold">{title}</h3>
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
