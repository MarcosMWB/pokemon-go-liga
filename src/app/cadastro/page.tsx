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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMensagem("");

    if (!friendCode.match(/^\d{4}\s?\d{4}\s?\d{4}$/)) {
      setMensagem("Friend Code inválido (use o formato: 1234 5678 9012)");
      return;
    }

    try {
      // cria no Auth
      const cred = await createUserWithEmailAndPassword(auth, email, senha);
      const user = cred.user;

      // salva no Firestore com verificado: false
      await setDoc(doc(db, "usuarios", user.uid), {
        nome,
        email,
        friend_code: friendCode.replace(/\s/g, ""),
        verificado: false, // <- controle nosso
        createdAt: Date.now(),
      });

      // tenta mandar email de verificação (se o hosting não estiver ok, só não vai redirecionar)
      try {
        await sendEmailVerification(user, {
          // se isso não existir/der erro, o cadastro continua
          url: "https://pokemon-go-liga.vercel.app/login?verify=1",
        });
      } catch (e) {
        console.warn("não consegui enviar email de verificação", e);
      }

      // desloga pra não ficar logado sem verificar
      await signOut(auth);

      // volta pro login com aviso
      router.replace("/login?verify=1");
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
      <input
        type="password"
        placeholder="Senha"
        required
        value={senha}
        onChange={(e) => setSenha(e.target.value)}
        className="w-full border p-2 mb-4"
      />
      <button type="submit" className="w-full bg-yellow-500 text-white p-2">
        Cadastrar
      </button>
      {mensagem && <p className="text-red-600 mt-2">{mensagem}</p>}
    </form>
  );
}
