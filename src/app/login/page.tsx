"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  signOut,
} from "firebase/auth";
import { doc, updateDoc, getDoc, setDoc } from "firebase/firestore";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [msg, setMsg] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg("");

    try {
      const cred = await signInWithEmailAndPassword(auth, email, senha);
      const user = cred.user;

      // 🟡 Se o e-mail ainda não foi verificado:
      if (!user.emailVerified) {
        try {
          await sendEmailVerification(user);
          setMsg(
            "Seu e-mail ainda não foi confirmado. Enviamos um novo link para sua caixa de entrada."
          );
        } catch (error) {
          console.error("Erro ao reenviar verificação:", error);
          setMsg("Seu e-mail não está verificado e houve um erro ao reenviar o link.");
        }

        // Sai da conta pra evitar acesso sem verificação
        await signOut(auth);
        return;
      }

      // 🟢 Se o e-mail está verificado, atualiza o Firestore
      try {
        const userRef = doc(db, "usuarios", user.uid);
        const snap = await getDoc(userRef);

        if (snap.exists()) {
          await updateDoc(userRef, { verificado: true });
        } else {
          await setDoc(userRef, {
            email: user.email || "",
            verificado: true,
            createdAt: Date.now(),
          });
        }
      } catch (e) {
        console.warn("Não foi possível marcar como verificado no Firestore:", e);
      }

      // Redireciona pro perfil
      router.push(`/perfil/${user.uid}`);
    } catch (err: any) {
      setMsg(err.message || "Erro ao fazer login.");
    }
  };

  const handleReset = async () => {
    if (!email) {
      setMsg("Informe seu email para recuperar a senha.");
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      setMsg("E-mail de recuperação enviado.");
    } catch (err: any) {
      setMsg(err.message || "Erro ao enviar recuperação.");
    }
  };

  const handleCadastro = () => {
    router.push("/cadastro");
  };

  return (
    <form onSubmit={handleLogin} className="p-8 max-w-md mx-auto">
      <h1 className="text-xl font-bold mb-4">Login</h1>
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        type="email"
        placeholder="Email"
        className="w-full border p-2 mb-2 text-black"
        required
      />
      <input
        value={senha}
        onChange={(e) => setSenha(e.target.value)}
        type="password"
        placeholder="Senha"
        className="w-full border p-2 mb-4 text-black"
        required
      />
      <button className="w-full bg-blue-500 text-white p-2">Entrar</button>

      <button
        type="button"
        onClick={handleReset}
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

      {msg && <p className="mt-3 text-sm text-red-600">{msg}</p>}
    </form>
  );
}
