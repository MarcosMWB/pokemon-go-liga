"use client";

import TipoBadge from "@/components/ui/TipoBadge";

export default function VsTipo({ tipo }: { tipo?: string }) {
  return (
    <div className="justify-self-center flex flex-col items-center">
      <div
        className="w-2 h-2 sm:w-20 sm:h-20 rounded-full border-4 border-red-600
                   text-red-600 flex items-center justify-center font-extrabold
                   text-2xl sm:text-5xl leading-none"
      >
        VS
      </div>

      <span className="mt-2 sm:hidden">
        <TipoBadge tipo={tipo} size={56} />
      </span>
      <span className="mt-2 hidden sm:inline-block">
        <TipoBadge tipo={tipo} size={100} />
      </span>
    </div>
  );
}
