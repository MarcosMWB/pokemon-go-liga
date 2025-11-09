// app/login/page.tsx ou onde você usava antes
"use client";

import { useState } from "react";
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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setMensagem("");

    try {
      const cred = await signInWithEmailAndPassword(auth, email, senha);
      const user = cred.user;
      // mesmo comportamento de antes, só que firebase usa .uid
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
      // se quiser redirecionar pra uma página sua depois do reset:
      // const actionCodeSettings = { url: `${window.location.origin}/reset` };
      // await sendPasswordResetEmail(auth, email, actionCodeSettings);
      await sendPasswordResetEmail(auth, email);
      setMensagem("E-mail de recuperação enviado.");
    } catch (err: any) {
      setMensagem(err.message || "Erro ao enviar recuperação.");
    }
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
      {mensagem && <p className="text-red-600 mt-2">{mensagem}</p>}
    </form>
  );
}
