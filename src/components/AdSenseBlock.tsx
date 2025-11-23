// src/components/AdSenseBlock.tsx
"use client";

import { useEffect } from "react";

type Props = {
  slot: string;
  className?: string;
};

declare global {
  interface Window {
    adsbygoogle: any[];
  }
}

export default function AdSenseBlock({ slot, className }: Props) {
  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        window.adsbygoogle = window.adsbygoogle || [];
        window.adsbygoogle.push({});
      }
    } catch {
      // ignora erros de inicialização
    }
  }, []);

  return (
    <ins
      className={`adsbygoogle block ${className ?? ""}`}
      style={{ display: "block" }}
      data-ad-client="ca-pub-2608686864167308"
      data-ad-slot={slot}
      data-ad-format="auto"
      data-full-width-responsive="true"
    />
  );
}
