"use client";

import { PokemonMiniResponsive } from "@/components/pokemon/PokemonMini";

export default function TeamPreview({
  names,
  nameToId,
  sizeSm = 22,
  sizeMd = 36,
  limit = 6,
  className = "",
}: {
  names: string[];
  nameToId: Record<string, number>;
  sizeSm?: number;
  sizeMd?: number;
  limit?: number;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap gap-1 sm:-space-x-1 ${className}`}>
      {names.slice(0, limit).map((nome) => {
        const baseName = nome.replace(/\s*\(.+\)\s*$/, "");
        const baseId = nameToId[baseName];
        return (
          <PokemonMiniResponsive
            key={nome}
            displayName={nome}
            baseId={baseId}
            sizeSm={sizeSm}
            sizeMd={sizeMd}
          />
        );
      })}
    </div>
  );
}
