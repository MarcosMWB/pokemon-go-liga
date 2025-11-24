// app/verify/page.tsx
"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { auth } from "@/lib/firebase";
import { applyActionCode } from "firebase/auth";

export const dynamic = "force-dynamic"; // evita pré-render estático da rota

function VerifyInner() {
  const router = useRouter();
  const sp = useSearchParams();

  const [status, setStatus] = useState<"idle" | "ok" | "invalid" | "error">("idle");
  const [msg, setMsg] = useState<string>("Verificando seu e-mail...");

  useEffect(() => {
    const mode = sp.get("mode");
    const oob = sp.get("oobCode");

    if (mode !== "verifyEmail" || !oob) {
      setStatus("invalid");
      setMsg("Link inválido ou incompleto.");
      return;
    }

    (async () => {
      try {
        await applyActionCode(auth, oob);
        try {
          await auth.currentUser?.reload();
        } catch {}
        setStatus("ok");
        setMsg("E-mail verificado. Redirecionando para o login...");
        setTimeout(() => router.replace("/login?verified=1"), 1200);
      } catch {
        setStatus("error");
        setMsg("Código inválido ou expirado.");
      }
    })();
  }, [sp, router]);

  return (
    <div className="p-6 max-w-md mx-auto">
      <h1 className="text-xl font-bold mb-2">Verificação de e-mail</h1>
      <p className={status === "error" || status === "invalid" ? "text-red-600" : "text-gray-800"}>
        {msg}
      </p>
      {(status === "error" || status === "invalid") && (
        <button
          onClick={() => router.replace("/login")}
          className="mt-4 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
        >
          Ir para o login
        </button>
      )}
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="p-6">Carregando…</div>}>
      <VerifyInner />
    </Suspense>
  );
}
