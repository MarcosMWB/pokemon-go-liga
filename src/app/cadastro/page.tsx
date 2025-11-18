"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signOut,
} from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";

export default function CadastroPage() {
  const router = useRouter();
  const [friendCode, setFriendCode] = useState("");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMensagem("");

    if (!friendCode.match(/^\d{4}\s?\d{4}\s?\d{4}$/)) {
      setMensagem("Friend Code inválido (use o formato: 1234 5678 9012)");
      return;
    }

    try {
      const cred = await createUserWithEmailAndPassword(auth, email, senha);
      const user = cred.user;

      await setDoc(doc(db, "usuarios", user.uid), {
        nome,
        email,
        friend_code: friendCode.replace(/\s/g, ""),
        verificado: false,
        createdAt: Date.now(),
      });

      await sendEmailVerification(user);
      await signOut(auth);

      router.replace("/login?verify=1");

      if (typeof window !== "undefined") {
        setTimeout(() => {
          window.location.href = "/login?verify=1";
        }, 200);
      }
    } catch (err: any) {
      setMensagem(err.message || "Erro ao cadastrar.");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-8 max-w-md mx-auto">
      <h1 className="text-xl font-bold mb-4">Cadastro</h1>

      <input
        type="text"
        placeholder="Código do treinador: 9999 0000 9999"
        required
        value={friendCode}
        onChange={(e) => setFriendCode(e.target.value)}
        className="w-full border p-2 mb-2"
      />

      <input
        type="text"
        placeholder="Nome"
        required
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        className="w-full border p-2 mb-2"
      />

      <input
        type="email"
        placeholder="Email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full border p-2 mb-2"
      />

      {/* Campo de senha com olho */}
      <div className="relative w-full mb-4">
        <input
          type={mostrarSenha ? "text" : "password"}
          placeholder="Senha"
          required
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          className="w-full border p-2 pr-10"
        />

        <button
          type="button"
          onClick={() => setMostrarSenha(!mostrarSenha)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600"
        >
          {mostrarSenha ? "🙈" : "👁️"}
        </button>
      </div>

      <button type="submit" className="w-full bg-yellow-500 text-white p-2">
        Cadastrar
      </button>

      {mensagem && <p className="text-red-600 mt-2">{mensagem}</p>}

      {mensagem && <p className="text-red-600 mt-2">{mensagem}</p>}

      <p className="text-red-600 mt-4 text-sm font-semibold">
        Caso não encontre o email de verificação, confira também sua caixa de Spam.
      </p>
    </form>
  );
}
