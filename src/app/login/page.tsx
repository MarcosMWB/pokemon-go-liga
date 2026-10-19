"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  signOut,
} from "firebase/auth";
import { doc, setDoc, getDoc, updateDoc, deleteField } from "firebase/firestore";
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

// mapeia PRIVATE -> PUBLIC (sem e-mail)
function pickPublicUser(src: any) {
  return {
    nome: typeof src?.nome === "string" ? src.nome : "",
    friend_code: typeof src?.friend_code === "string" ? src.friend_code : "",
    createdAt: src?.createdAt ?? Date.now(),
  };
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [msg, setMsg] = useState<string>("");
  const [kind, setKind] = useState<"info" | "error" | "success">("info");
  const [loading, setLoading] = useState(false);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);

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
            "Confira também sua caixa de SPAM/Lixo/Pastas de Promoções e valide para poder acessar."
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

      // 1) marca PRIVATE como verificado
      try {
        await setDoc(
          doc(db, "usuarios_private", user.uid),
          {
            email: user.email ?? "",
            updatedAtMs: Date.now(),
          },
          { merge: true }
        );
      } catch {
        console.warn("Falha ao marcar verificado no PRIVATE (prossegue).");
      }

      // 2) cria PUBLIC se não existir ainda (sem e-mail)
      try {
        const privRef = doc(db, "usuarios_private", user.uid);
        const pubRef  = doc(db, "usuarios", user.uid);

        const [privSnap, pubSnap] = await Promise.all([getDoc(privRef), getDoc(pubRef)]);
        if (!pubSnap.exists()) {
          await setDoc(pubRef, pickPublicUser(privSnap.data()), { merge: false });
        } else if (Object.prototype.hasOwnProperty.call(pubSnap.data(), "email")) {
          // Migra o campo legado para fora do perfil que qualquer visitante pode ler.
          await updateDoc(pubRef, { email: deleteField() });
        }
      } catch (e) {
        console.warn("Falha ao espelhar PUBLIC (prossegue).", e);
      }

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
    <form onSubmit={handleLogin} className="mx-auto my-4 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
      <h1 className="mb-2 text-2xl font-bold text-slate-950">Entrar na sua conta</h1>
      <p className="mb-6 text-base leading-7 text-slate-700">Use o e-mail e a senha que você cadastrou na Liga. Não compartilhe sua senha com ninguém.</p>

      <label htmlFor="login-email" className="mb-1 block text-base font-semibold text-slate-800">E-mail da conta</label>
      <input
        id="login-email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        type="email"
        placeholder="seuemail@dominio.com"
        className="mb-4 min-h-12 w-full rounded-lg border border-slate-400 p-3 text-base text-black"
        required
        autoComplete="email"
        inputMode="email"
      />

      <label htmlFor="login-password" className="mb-1 block text-base font-semibold text-slate-800">Senha</label>
      <input
        id="login-password"
        value={senha}
        onChange={(e) => setSenha(e.target.value)}
        type="password"
        placeholder="Sua senha"
        className="mb-4 min-h-12 w-full rounded-lg border border-slate-400 p-3 text-base text-black"
        required
        autoComplete="current-password"
      />

      <button
        disabled={loading}
        className={`min-h-12 w-full rounded-lg p-3 text-base font-bold text-white ${
          loading ? "bg-blue-400" : "bg-blue-600 hover:bg-blue-700"
        }`}
      >
        {loading ? "Entrando..." : "Entrar"}
      </button>

      <div className="mt-4 flex flex-col gap-2 text-base sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={handleReset}
          className="min-h-11 self-start font-semibold text-blue-800 underline underline-offset-2 disabled:opacity-60"
          disabled={loading}
        >
          Esqueci ou quero trocar minha senha
        </button>

        <button
          type="button"
          onClick={handleCadastro}
          className="min-h-11 self-start font-semibold text-blue-800 underline underline-offset-2 disabled:opacity-60"
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
            pastas <strong>SPAM</strong>, <strong>Promoções</strong> e{" "}
            <strong>Lixo Eletrônico</strong>. Após confirmar, faça login novamente.
          </p>
        </div>
      )}

      <p className={msgClasses} aria-live="polite">
        {msg}
      </p>
    </form>
  );
}
