"use client";
import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import { applyActionCode } from "firebase/auth";

export default function VerifyPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const [msg, setMsg] = useState("Verificando seu e-mail...");

  useEffect(() => {
    const code = sp.get("oobCode");
    if (!code) {
      setMsg("Código inválido.");
      return;
    }
    (async () => {
      try {
        await applyActionCode(auth, code);
        setMsg("✅ E-mail verificado com sucesso! Você já pode fazer login.");
        // opcional: redirecionar depois de alguns segundos
        // setTimeout(() => router.replace("/login?verified=1"), 1500);
      } catch (e) {
        setMsg("Não foi possível verificar o e-mail (link inválido ou expirado).");
      }
    })();
  }, [sp, router]);

  return <div className="p-8 max-w-md mx-auto">{msg}</div>;
}
