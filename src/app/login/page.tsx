"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  signOut,
} from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import type { FirebaseError } from "firebase/app";

function mapAuthError(err: unknown): string {
  const code =
    (err as FirebaseError)?.code ||
    (typeof err === "object" && err && (err as any).code) ||
    "";

  switch (code) {
    case "auth/invalid-email":
      return "E-mail inválido.";
    case "auth/missing-password":
      return "Informe sua senha.";
    case "auth/user-disabled":
      return "Conta desativada. Contate o suporte.";
    case "auth/user-not-found":
      return "Usuário não encontrado.";
    case "auth/wrong-password":
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
      return "E-mail ou senha incorretos.";
    case "auth/too-many-requests":
      return "Muitas tentativas. Tente novamente em alguns minutos.";
    case "auth/network-request-failed":
      return "Falha de rede. Verifique sua conexão.";
    default:
      return "Erro ao fazer login. Tente novamente.";
  }
}

export default function LoginPage() {
  const router = useRouter();
  const search = useSearchParams();

  const [email, setEmail] = useState(() => search.get("email") ?? "");
  const [senha, setSenha] = useState("");
  const [msg, setMsg] = useState<string>("");
  const [kind, setKind] = useState<"info" | "error" | "success">("info");
  const [loading, setLoading] = useState(false);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);

  // mensagens de querystring
  useEffect(() => {
    if (search.get("verified") === "1") {
      setKind("success");
      setMsg("E-mail verificado. Faça login para continuar.");
    } else if (search.get("verify") === "1") {
      setKind("info");
      setMsg("Enviamos um link de verificação para o seu e-mail. Confirme para acessar.");
    }
  }, [search]);

  const msgClasses = useMemo(() => {
    if (!msg) return "hidden";
    if (kind === "error") return "mt-3 text-sm text-red-600";
    if (kind === "success") return "mt-3 text-sm text-emerald-700";
    return "mt-3 text-sm text-gray-700";
  }, [msg, kind]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg("");
    setKind("info");
    setUnverifiedEmail(null);
    setLoading(true);

    const emailTrim = email.trim();
    const senhaTrim = senha;

    try {
      const cred = await signInWithEmailAndPassword(auth, emailTrim, senhaTrim);
      await cred.user.reload();
      const user = auth.currentUser!;

      if (!user.emailVerified) {
        try {
          await sendEmailVerification(user);
          setUnverifiedEmail(emailTrim);
          setKind("info");
          setMsg(
            `Seu e-mail ainda não foi confirmado. Reenviamos o link para ${emailTrim}. ` +
              "Confira também SPAM/Promoções e valide para acessar."
          );
        } catch (error: any) {
          setUnverifiedEmail(emailTrim);
          setKind("error");
          setMsg(
            error?.code === "auth/too-many-requests"
              ? "Muitas tentativas de verificação. Aguarde alguns minutos e tente de novo."
              : "Seu e-mail não está verificado e houve um erro ao reenviar o link. Tente novamente."
          );
        }
        await signOut(auth);
        return;
      }

      // marcou verificado no PRIVATE (usado pelo espelho público na Cloud Functions)
      await setDoc(
        doc(db, "usuarios_private", user.uid),
        {
          verificado: true,
          email: user.email ?? "",
          updatedAtMs: Date.now(),
        },
        { merge: true }
      );

      setKind("success");
      setMsg("Login realizado com sucesso.");
      router.push(`/perfil/${user.uid}`);
    } catch (err: any) {
      setKind("error");
      setMsg(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    setMsg("");
    setKind("info");
    if (!email.trim()) {
      setKind("error");
      setMsg("Informe seu e-mail para recuperar a senha.");
      return;
    }
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setKind("success");
      setMsg("E-mail de recuperação enviado. Verifique sua caixa de entrada e SPAM.");
    } catch (err) {
      setKind("error");
      setMsg(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCadastro = () => {
    router.push("/cadastro");
  };

  return (
    <form onSubmit={handleLogin} className="p-8 max-w-md mx-auto">
      <h1 className="text-xl font-bold mb-4">Login</h1>

      <label className="block text-sm mb-1">E-mail</label>
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        type="email"
        placeholder="seuemail@dominio.com"
        className="w-full border p-2 mb-3 text-black rounded"
        required
        autoComplete="email"
        inputMode="email"
      />

      <label className="block text-sm mb-1">Senha</label>
      <input
        value={senha}
        onChange={(e) => setSenha(e.target.value)}
        type="password"
        placeholder="Sua senha"
        className="w-full border p-2 mb-4 text-black rounded"
        required
        autoComplete="current-password"
      />

      <button
        disabled={loading}
        className={`w-full p-2 rounded text-white ${
          loading ? "bg-blue-400" : "bg-blue-600 hover:bg-blue-700"
        }`}
      >
        {loading ? "Entrando..." : "Entrar"}
      </button>

      <div className="flex items-center justify-between mt-3 text-sm">
        <button
          type="button"
          onClick={handleReset}
          className="text-blue-600 underline disabled:opacity-60"
          disabled={loading}
        >
          Esqueci minha senha
        </button>

        <button
          type="button"
          onClick={handleCadastro}
          className="text-blue-600 underline disabled:opacity-60"
          disabled={loading}
        >
          Cadastro
        </button>
      </div>

      {unverifiedEmail && (
        <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <p className="font-medium">E-mail não verificado</p>
          <p className="mt-1">
            Enviamos um link de verificação para <strong>{unverifiedEmail}</strong>. Procure nas
            pastas <strong>SPAM</strong>, <strong>Promoções</strong> e <strong>Lixo Eletrônico</strong>. Após confirmar, faça login novamente.
          </p>
        </div>
      )}

      <p className={msgClasses} aria-live="polite">
        {msg}
      </p>
    </form>
  );
}
