"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from "firebase/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mensagem, setMensagem] = useState("");

  // lê ?verify=1 da URL sem usar useSearchParams
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("verify") === "1") {
      setMensagem("E-mail verificado! Agora você pode fazer login. 👍");
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setMensagem("");

    try {
      const cred = await signInWithEmailAndPassword(auth, email, senha);
      const user = cred.user;

      // se quiser travar quem não verificou:
      // if (!user.emailVerified) {
      //   setMensagem("Confirme seu e-mail antes de entrar.");
      //   return;
      // }

      router.push(`/perfil/${user.uid}`);
    } catch (err: any) {
      setMensagem(err.message || "Erro ao fazer login.");
    }
  };

  const handlePasswordReset = async () => {
    if (!email) {
      setMensagem("Informe seu e-mail para recuperar a senha.");
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      setMensagem("E-mail de recuperação enviado.");
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
        className="w-full border p-2 mb-2 text-black"
      />
      <input
        type="password"
        placeholder="Senha"
        required
        value={senha}
        onChange={(e) => setSenha(e.target.value)}
        className="w-full border p-2 mb-4 text-black"
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
      {mensagem && <p className="text-red-600 mt-2">{mensagem}</p>}
    </form>
  );
}
