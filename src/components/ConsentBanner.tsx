"use client";

import { useEffect, useState } from "react";

type ConsentState = "granted" | "denied";
type Stored = {
  set: boolean;
  ad_storage: ConsentState;
  analytics_storage: ConsentState;
  ad_user_data: ConsentState;
  ad_personalization: ConsentState;
};

declare global {
  interface Window {
    dataLayer: any[];
    gtag: (...args: any[]) => void;
  }
}

const KEY = "consent_v2";

function ensureGtag() {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];
  // garante que window.gtag aceite qualquer número de argumentos
  window.gtag =
    window.gtag ||
    function (...args: any[]) {
      window.dataLayer.push(args);
    };
}

function applyConsent(c: Stored) {
  ensureGtag();
  window.gtag("consent", "update", {
    ad_storage: c.ad_storage,
    analytics_storage: c.analytics_storage,
    ad_user_data: c.ad_user_data,
    ad_personalization: c.ad_personalization,
    functionality_storage: "granted",
    security_storage: "granted",
  });
}

export default function ConsentBanner() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved: Stored = JSON.parse(raw);
        if (saved?.set) applyConsent(saved);
        setOpen(false);
      } else {
        setOpen(true);
      }
    } catch {
      setOpen(true);
    }
  }, []);

  function acceptAll() {
    const choice: Stored = {
      set: true,
      ad_storage: "granted",
      analytics_storage: "granted",
      ad_user_data: "granted",
      ad_personalization: "granted",
    };
    localStorage.setItem(KEY, JSON.stringify(choice));
    applyConsent(choice);
    setOpen(false);
  }

  function rejectNonEssential() {
    const choice: Stored = {
      set: true,
      ad_storage: "denied",
      analytics_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    };
    localStorage.setItem(KEY, JSON.stringify(choice));
    applyConsent(choice);
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50">
      <div className="mx-auto max-w-4xl m-3 rounded-lg border bg-white p-4 shadow">
        <p className="text-sm text-gray-800">
          Usamos cookies para funcionalidades básicas e, com seu consentimento,
          para métricas e anúncios. Você pode aceitar tudo ou manter apenas os essenciais.
          Veja nossa <a href="/privacidade" className="underline">Política de Privacidade</a>.
        </p>
        <div className="mt-3 flex gap-2 justify-end">
          <button onClick={rejectNonEssential} className="px-3 py-1.5 rounded border text-sm">
            Manter só essenciais
          </button>
          <button onClick={acceptAll} className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm">
            Aceitar tudo
          </button>
        </div>
      </div>
    </div>
  );
}
