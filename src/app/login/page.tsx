// app/login/page.tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { auth } from "@/lib/firebase";
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  signOut,
} from "firebase/auth";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [info, setInfo] = useState("");

  // se veio de /cadastro com ?verify=1
  useEffect(() => {
    const v = searchParams.get("verify");
    if (v === "1") {
      setInfo("Cadastro feito! Confirme seu e-mail antes de entrar.");
    }
  }, [searchParams]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setMensagem("");
    setInfo("");

    try {
      const cred = await signInWithEmailAndPassword(auth, email, senha);
      const user = cred.user;

      // se o e-mail não foi verificado ainda
      if (!user.emailVerified) {
        // manda outro e-mail de verificação
        try {
          await sendEmailVerification(user);
          setInfo("Seu e-mail ainda não foi confirmado. Reenviamos o link.");
        } catch {
          setInfo("Seu e-mail ainda não foi confirmado.");
        }

        // desloga pra não ficar logado sem verificar
        await signOut(auth);
        return;
      }

      // ok, pode entrar
      router.push(`/perfil/${user.uid}`);
    } catch (err: any) {
      setMensagem(err.message || "Erro ao fazer login.");
    }
  };

  const handlePasswordReset = async () => {
    if (!email) {
      setMensagem("Informe seu email para recuperar a senha.");
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      setInfo("E-mail de recuperação enviado.");
      setMensagem("");
    } catch (err: any) {
      setMensagem(err.message || "Erro ao enviar recuperação.");
    }
  };

  const handleCadastro = () => {
    router.push("/cadastro");
  };

  return (
    <form onSubmit={handleLogin} className="p-8 max-w-md mx-auto">
      <h1 className="text-xl font-bold mb-4">Login</h1>
      <input
        type="email"
        placeholder="Email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full border p-2 mb-2"
      />
      <input
        type="password"
        placeholder="Senha"
        required
        value={senha}
        onChange={(e) => setSenha(e.target.value)}
        className="w-full border p-2 mb-4"
      />
      <button type="submit" className="w-full bg-blue-500 text-white p-2">
        Entrar
      </button>

      <button
        type="button"
        onClick={handlePasswordReset}
        className="w-full mt-2 text-sm text-blue-600 underline"
      >
        Esqueci minha senha
      </button>

      <button
        type="button"
        onClick={handleCadastro}
        className="w-full mt-2 text-sm text-blue-600 underline"
      >
        Cadastro
      </button>

      {info && <p className="text-green-600 mt-2">{info}</p>}
      {mensagem && <p className="text-red-600 mt-2">{mensagem}</p>}
    </form>
  );
}
