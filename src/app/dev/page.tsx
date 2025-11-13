// src/app/dev/page.tsx
"use client";
import Link from "next/link";

export default function DevHome() {
  return (
    <main className="max-w-3xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold">Dev</h1>
      <ul className="list-disc pl-5 space-y-1">
        <li><Link href="/dev/desafios" className="text-blue-600 underline">Desafios (Jogador vs Líder)</Link></li>
        <li><Link href="/dev/disputas" className="text-blue-600 underline">Disputas (painel)</Link></li>
        <li><Link href="/dev/conflitos" className="text-blue-600 underline">Conflitos</Link></li>
      </ul>
    </main>
  );
}
