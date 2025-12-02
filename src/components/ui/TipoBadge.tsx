"use client";

import Image from "next/image";
import { TYPE_ICONS } from "@/utils/typeIcons";

export default function TipoBadge({ tipo, size = 22 }: { tipo?: string; size?: number }) {
  if (!tipo) return <span className="text-xs text-gray-500">—</span>;
  const src = TYPE_ICONS[tipo];
  if (!src) return <span className="capitalize">{tipo}</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <Image src={src} alt={tipo} width={size} height={size} />
      <span className="capitalize">{tipo}</span>
    </span>
  );
}
