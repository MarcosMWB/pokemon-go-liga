// src/app/elite4/placar/page.tsx
import { Suspense } from "react";
import PlacarClient from "./PlacarClient";

export const dynamic = "force-dynamic";

export default function Page({
  searchParams,
}: {
  searchParams: { liga?: string };
}) {
  const liga = (searchParams?.liga as string) || "Great";

  return (
    <Suspense fallback={<div className="p-6">Carregando…</div>}>
      <PlacarClient liga={liga} />
    </Suspense>
  );
}
