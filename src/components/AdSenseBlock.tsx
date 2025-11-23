// src/components/AdSenseBlock.tsx
"use client";
import { useEffect } from "react";

declare global {
  interface Window { adsbygoogle: unknown[]; }
}

type Props = {
  slot: string;        // data-ad-slot do bloco criado no AdSense
  layout?: string;     // e.g., "in-article", "in-feed"
  style?: React.CSSProperties;
};

export default function AdSenseBlock({ slot, layout, style }: Props) {
  useEffect(() => {
    try {
      // @ts-ignore
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {}
  }, [slot]);

  return (
    <ins
      className="adsbygoogle"
      style={style ?? { display: "block" }}
      data-ad-client={process.env.NEXT_PUBLIC_ADSENSE_CLIENT}
      data-ad-slot={slot}
      data-ad-format="auto"
      data-full-width-responsive="true"
      {...(layout ? { "data-ad-layout": layout } : {})}
    />
  );
}