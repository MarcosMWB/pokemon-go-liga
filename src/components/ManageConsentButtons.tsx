"use client";

type ConsentState = "granted" | "denied";
type Stored = {
  set: boolean;
  ad_storage: ConsentState;
  analytics_storage: ConsentState;
  ad_user_data: ConsentState;
  ad_personalization: ConsentState;
};

const KEY = "consent_v2";

function applyConsent(c: Stored) {
  const w = window as any;
  w.dataLayer = w.dataLayer || [];
  function gtag(...args: any[]) {
    w.dataLayer.push(args);
  }
  gtag("consent", "update", {
    ad_storage: c.ad_storage,
    analytics_storage: c.analytics_storage,
    ad_user_data: c.ad_user_data,
    ad_personalization: c.ad_personalization,
    functionality_storage: "granted",
    security_storage: "granted",
  });
}

export default function ManageConsentButtons() {
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
    alert("Preferências salvas: tudo aceito.");
  }

  function essentialsOnly() {
    const choice: Stored = {
      set: true,
      ad_storage: "denied",
      analytics_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    };
    localStorage.setItem(KEY, JSON.stringify(choice));
    applyConsent(choice);
    alert("Preferências salvas: apenas essenciais.");
  }

  function resetChoice() {
    localStorage.removeItem(KEY);
    alert("Preferências limpas. O banner voltará a aparecer na próxima navegação.");
  }

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <button type="button" onClick={essentialsOnly} className="px-3 py-1.5 rounded border text-sm">
        Manter só essenciais
      </button>
      <button type="button" onClick={acceptAll} className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm">
        Aceitar tudo
      </button>
      <button type="button" onClick={resetChoice} className="px-3 py-1.5 rounded border text-sm">
        Limpar preferência
      </button>
    </div>
  );
}
