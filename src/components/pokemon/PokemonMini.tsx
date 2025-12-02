"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

/** -------- helpers p/ nomes/variantes -------- */
export function formatName(name: string) {
  return name
    .split("-")
    .map((w) => (w[0] ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
export function slugifyBase(displayBase: string) {
  return displayBase
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.’'"]/g, "")
    .replace(/\./g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}
export function suffixToToken(suf: string) {
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
export function buildFormSlug(displayName: string): string | null {
  const m = displayName.match(/^(.*)\((.+)\)\s*$/);
  if (!m) return null;
  const base = slugifyBase(m[1]);
  const token = suffixToToken(m[2]);
  return `${base}-${token}`;
}
export function spriteMiniById(id: number) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
}
export function officialArtworkById(id: number) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
}

/** -------- componentes -------- */
export function PokemonMini({
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

export function PokemonMiniResponsive({
  displayName,
  baseId,
  sizeSm = 44,
  sizeMd = 80,
}: {
  displayName: string;
  baseId?: number;
  sizeSm?: number;
  sizeMd?: number;
}) {
  return (
    <>
      <span className="inline-block sm:hidden">
        <PokemonMini displayName={displayName} baseId={baseId} size={sizeSm} />
      </span>
      <span className="hidden sm:inline-block">
        <PokemonMini displayName={displayName} baseId={baseId} size={sizeMd} />
      </span>
    </>
  );
}
