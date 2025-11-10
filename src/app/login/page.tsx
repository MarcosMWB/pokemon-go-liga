"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
} from "firebase/auth";
import { doc, getDoc, updateDoc } from "firebase/firestore";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const showVerifyMsg = searchParams.get("verify") === "1";

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mensagem, setMensagem] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setMensagem("");

    try {
      const cred = await signInWithEmailAndPassword(auth, email, senha);
      const user = cred.user;

      // busca no Firestore
      const uSnap = await getDoc(doc(db, "usuarios", user.uid));
      const dados = uSnap.exists() ? (uSnap.data() as any) : null;

      // casos em que a gente NÃO deixa entrar:
      // 1) firebase diz que não está verificado
      // 2) firestore tem verificado === false
      const emailNaoVerificado = !user.emailVerified;
      const firestoreNaoVerificado = dados && dados.verificado === false;

      if (emailNaoVerificado || firestoreNaoVerificado) {
        // se o firebase já marcou verificado (caso o link funcione), aproveita e marca no firestore
        if (!firestoreNaoVerificado && user.emailVerified && uSnap.exists()) {
          await updateDoc(doc(db, "usuarios", user.uid), {
            verificado: true,
          });
        }

        await signOut(auth);
        setMensagem(
          "Seu e-mail ainda não foi verificado. Verifique sua caixa de entrada e clique no link. Depois faça login novamente."
        );
        return;
      }

      // se chegou aqui, tá ok
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
      await sendPasswordResetEmail(auth, email, {
        url: "https://pokemon-go-liga.vercel.app/login",
      });
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

      {showVerifyMsg && (
        <p className="mb-3 text-sm text-green-700 bg-green-100 px-3 py-2 rounded">
          Cadastro feito! Verifique o e-mail que enviamos e depois faça login.
        </p>
      )}

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
      {mensagem && <p className="text-red-600 mt-2">{mensagem}</p>}
    </form>
  );
}
