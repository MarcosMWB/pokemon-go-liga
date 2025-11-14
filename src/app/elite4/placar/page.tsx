// src/app/elite4/placar/page.tsx
import { Suspense } from "react";
import PlacarClient from "./PlacarClient";

export const dynamic = "force-dynamic";

type SearchParams =
  | Promise<Record<string, string | string[] | undefined>>
  | Record<string, string | string[] | undefined>;

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  // Compat: aceita Promise (Next 15) ou objeto direto (versões anteriores)
  const sp =
    typeof (searchParams as any)?.then === "function"
      ? await (searchParams as Promise<Record<string, string | string[] | undefined>>)
      : (searchParams as Record<string, string | string[] | undefined>);

  const rawLiga = sp?.liga;
  const liga = Array.isArray(rawLiga) ? rawLiga[0] : rawLiga || "Great";

  return (
    <Suspense fallback={<div className="p-6">Carregando…</div>}>
      <PlacarClient liga={liga} />
    </Suspense>
  );
}
