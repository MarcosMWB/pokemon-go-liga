"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { auth } from "@/lib/firebase";
import { applyActionCode } from "firebase/auth";

export default function VerifyPage() {
  const router = useRouter();
  const q = useSearchParams();
  const [status, setStatus] = useState<"loading"|"ok"|"error">("loading");
  const [msg, setMsg] = useState("Validando verificação de e-mail...");

  useEffect(() => {
    const mode = q.get("mode");      // "verifyEmail"
    const oob = q.get("oobCode");    // código da ação
    const email = q.get("continueUrlEmail") || ""; // opcional pra pré-preencher o login

    if (mode !== "verifyEmail" || !oob) {
      setStatus("error");
      setMsg("Link inválido ou expirado.");
      return;
    }

    (async () => {
      try {
        await applyActionCode(auth, oob);
        setStatus("ok");
        setMsg("E-mail verificado. Redirecionando para o login...");
        setTimeout(() => {
          router.replace(`/login?verified=1${email ? `&email=${encodeURIComponent(email)}` : ""}`);
        }, 1200);
      } catch (e) {
        setStatus("error");
        setMsg("Falha ao verificar seu e-mail. Solicite um novo link.");
      }
    })();
  }, [q, router]);

  return (
    <div className="max-w-md mx-auto p-8">
      <h1 className="text-xl font-bold mb-3">Verificação de e-mail</h1>
      <p className={status === "error" ? "text-red-600" : "text-gray-800"}>{msg}</p>
    </div>
  );
}
