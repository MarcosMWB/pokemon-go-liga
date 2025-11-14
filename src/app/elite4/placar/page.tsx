// src/app/elite4/placar/page.tsx
import PlacarClient from "./PlacarClient";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

export default async function Page({ searchParams }: { searchParams?: Promise<SP> }) {
  const sp = (await searchParams) ?? {};
  const rawLiga = sp.liga;
  const liga = Array.isArray(rawLiga) ? rawLiga[0] : rawLiga ?? "Great";
  return <PlacarClient liga={liga} />;
}
