"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signOut,
} from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

export default function CadastroPage() {
  const router = useRouter();

  const [friendCode, setFriendCode] = useState("");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");

  const [mostrarSenha, setMostrarSenha] = useState(false);

  const [mensagemErro, setMensagemErro] = useState("");
  const [mensagemInfo, setMensagemInfo] = useState("");

  const [aceitoDados, setAceitoDados] = useState(false);
  const [declaraFriendCode, setDeclaraFriendCode] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMensagemErro("");
    setMensagemInfo("");

    if (!friendCode.match(/^\d{4}\s?\d{4}\s?\d{4}$/)) {
      setMensagemErro("Friend Code inválido (use o formato: 1234 5678 9012)");
      return;
    }
    if (!declaraFriendCode || !aceitoDados) {
      setMensagemErro("Você precisa marcar os dois consentimentos para continuar.");
      return;
    }

    try {
      const cred = await createUserWithEmailAndPassword(auth, email, senha);
      const user = cred.user;

      await setDoc(
        doc(db, "usuarios_private", user.uid),
        {
          nome,
          email,
          friend_code: friendCode.replace(/\s/g, ""),
          createdAt: serverTimestamp(),
          consentimentos: {
            versao: "v1-2025-11-24",
            dadosSensiveisEmail: true,
            declaracaoFriendCodeVerdadeiro: true,
            timestamp: serverTimestamp(),
            userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
          },
        },
        { merge: true }
      );

      // base estável (não depende do window nem do subdomínio de preview)
      const BASE_URL =
        process.env.NEXT_PUBLIC_APP_URL || "https://pokemon-go-liga.vercel.app";

      try {
        // usa o handler hospedado do Firebase e redireciona para seu /login
        await sendEmailVerification(user, {
          url: `${BASE_URL}/login?verify=1`,
          handleCodeInApp: false,
        });
      } catch (e: any) {
        console.error("sendEmailVerification falhou:", e?.code, e?.message);
        setMensagemErro(
          e?.code === "auth/unauthorized-continue-uri"
            ? "Domínio da URL de retorno não está autorizado no Firebase Auth."
            : e?.message || "Falha ao enviar e-mail de verificação."
        );
        // opcional: não faça signOut/router.replace se falhou aqui
        return;
      }


      setMensagemInfo(
        `Enviamos um e-mail de verificação para ${email}. Abra a mensagem e confirme seu cadastro. ` +
        `Se não achar, verifique também a caixa de Spam. Só é possível fazer login após verificar o e-mail.`
      );

      await signOut(auth);
      setTimeout(() => {
        router.replace(`/login?verify=1&email=${encodeURIComponent(email)}`);
      }, 2500);
    } catch (err: any) {
      setMensagemErro(err?.message || "Erro ao cadastrar.");
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

      <div className="relative w-full mb-2">
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
          aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
        >
          {mostrarSenha ? "🙈" : "👁️"}
        </button>
      </div>

      <label className="flex items-start gap-2 text-sm mb-2">
        <input
          type="checkbox"
          checked={declaraFriendCode}
          onChange={(e) => setDeclaraFriendCode(e.target.checked)}
          className="mt-1"
          required
        />
        <span>
          Declaro que meu <b>Friend Code</b> é verdadeiro e compreendo que a conta
          pode ser <b>excluída</b> em caso de fraude.
        </span>
      </label>

      <label className="flex items-start gap-2 text-sm mb-4">
        <input
          type="checkbox"
          checked={aceitoDados}
          onChange={(e) => setAceitoDados(e.target.checked)}
          className="mt-1"
          required
        />
        <span>
          Autorizo o tratamento dos meus <b>dados pessoais (e-mail)</b> para
          autenticação, comunicação da plataforma e segurança, conforme a
          Política de Privacidade.
        </span>
      </label>

      <button type="submit" className="w-full bg-yellow-500 text-white p-2">
        Cadastrar
      </button>

      {mensagemErro && <p className="text-red-600 mt-2">{mensagemErro}</p>}
      {mensagemInfo && <p className="text-green-700 mt-2">{mensagemInfo}</p>}

      <p className="text-gray-600 mt-4 text-sm">
        Não recebeu o e-mail? Verifique também a caixa de <b>Spam</b>.
      </p>
    </form>
  );
}