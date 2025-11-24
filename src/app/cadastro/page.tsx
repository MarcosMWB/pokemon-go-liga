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
import type { FirebaseError } from "firebase/app";

function mapSignupError(err: unknown): string {
  const code =
    (err as FirebaseError)?.code ||
    (typeof err === "object" && err && (err as any).code) ||
    "";

  switch (code) {
    case "auth/email-already-in-use":
      return "Este e-mail já está em uso.";
    case "auth/invalid-email":
      return "E-mail inválido.";
    case "auth/weak-password":
      return "Senha fraca. Use pelo menos 6 caracteres.";
    case "auth/operation-not-allowed":
      return "Cadastro com e-mail/senha está desabilitado no Firebase.";
    case "auth/too-many-requests":
      return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
    case "auth/network-request-failed":
      return "Falha de rede. Verifique sua conexão.";
    default:
      return "Erro ao cadastrar. Tente novamente.";
  }
}

export default function CadastroPage() {
  const router = useRouter();

  const [friendCode, setFriendCode] = useState("");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");

  const [mostrarSenha, setMostrarSenha] = useState(false);

  const [mensagemErro, setMensagemErro] = useState("");
  const [mensagemInfo, setMensagemInfo] = useState("");
  const [loading, setLoading] = useState(false);

  // consentimentos obrigatórios
  const [aceitoDados, setAceitoDados] = useState(false);
  const [declaraFriendCode, setDeclaraFriendCode] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    setMensagemErro("");
    setMensagemInfo("");

    // validações simples
    if (!friendCode.match(/^\d{4}\s?\d{4}\s?\d{4}$/)) {
      setMensagemErro("Friend Code inválido (use o formato: 1234 5678 9012).");
      return;
    }
    if (!declaraFriendCode || !aceitoDados) {
      setMensagemErro("Marque os dois consentimentos para continuar.");
      return;
    }

    setLoading(true);
    try {
      // 1) cria usuário no Auth
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), senha);
      const user = cred.user;

      // 2) grava registro privado
      try {
        await setDoc(
          doc(db, "usuarios_private", user.uid),
          {
            nome: nome.trim(),
            email: email.trim(),
            friend_code: friendCode.replace(/\s/g, ""),
            createdAt: serverTimestamp(),
            createdAtMs: Date.now(), // ajuda no admin "há quanto tempo"
            consentimentos: {
              versao: "v1-2025-11-24",
              dadosSensiveisEmail: true,
              declaracaoFriendCodeVerdadeiro: true,
              timestamp: serverTimestamp(),
              userAgent:
                typeof navigator !== "undefined" ? navigator.userAgent : null,
            },
          },
          { merge: true }
        );
      } catch (w) {
        // não bloqueia o fluxo, mas avisa
        console.warn("Falha ao gravar usuarios_private:", w);
      }

      // 3) envia e-mail de verificação
      const BASE_URL =
        process.env.NEXT_PUBLIC_APP_URL || "https://pokemon-go-liga.vercel.app";

      try {
        // caminho principal: usa página padrão do Firebase e volta para /login
        await sendEmailVerification(user, {
          url: `${BASE_URL}/login?verify=1`,
          handleCodeInApp: false,
        });
      } catch (e: any) {
        // fallback quando domínio de retorno não está autorizado ou similar
        const code = e?.code || "";
        if (
          code === "auth/unauthorized-continue-uri" ||
          code === "auth/invalid-continue-uri" ||
          code === "auth/invalid-dynamic-link-domain"
        ) {
          try {
            await sendEmailVerification(user, {
              url: `${BASE_URL}/verify`,
              handleCodeInApp: true, // usa sua rota /verify
            });
          } catch (e2: any) {
            console.error("Falha no fallback de verificação:", e2?.code, e2?.message);
            setMensagemErro(
              "Não consegui enviar o e-mail de verificação (verifique Domínios Autorizados no Firebase Auth)."
            );
            // encerra aqui sem sair do auth para não travar o usuário num estado estranho
            setLoading(false);
            return;
          }
        } else if (code === "auth/too-many-requests") {
          setMensagemErro("Muitas tentativas de verificação. Tente novamente mais tarde.");
          setLoading(false);
          return;
        } else if (code === "auth/network-request-failed") {
          setMensagemErro("Falha de rede ao enviar o e-mail. Verifique sua conexão.");
          setLoading(false);
          return;
        } else {
          console.error("sendEmailVerification erro:", e?.code, e?.message);
          setMensagemErro("Falha ao enviar o e-mail de verificação.");
          setLoading(false);
          return;
        }
      }

      // 4) mensagem + força logout + redireciona para login com aviso
      setMensagemInfo(
        `Enviamos um e-mail de verificação para ${email}. Confirme para poder acessar. ` +
          `Confira também a caixa de SPAM.`
      );

      await signOut(auth);
      setTimeout(() => {
        router.replace(`/login?verify=1&email=${encodeURIComponent(email.trim())}`);
      }, 2200);
    } catch (err) {
      setMensagemErro(mapSignupError(err));
      console.error(err);
    } finally {
      setLoading(false);
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
        autoComplete="off"
        inputMode="numeric"
      />

      <input
        type="text"
        placeholder="Nome"
        required
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        className="w-full border p-2 mb-2"
        autoComplete="name"
      />

      <input
        type="email"
        placeholder="E-mail"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full border p-2 mb-2"
        autoComplete="email"
        inputMode="email"
      />

      <div className="relative w-full mb-2">
        <input
          type={mostrarSenha ? "text" : "password"}
          placeholder="Senha"
          required
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          className="w-full border p-2 pr-10"
          autoComplete="new-password"
        />
        <button
          type="button"
          onClick={() => setMostrarSenha(!mostrarSenha)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600"
          aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
          tabIndex={-1}
        >
          {mostrarSenha ? "🙈" : "👁️"}
        </button>
      </div>

      {/* Consentimentos */}
      <label className="flex items-start gap-2 text-sm mb-2">
        <input
          type="checkbox"
          checked={declaraFriendCode}
          onChange={(e) => setDeclaraFriendCode(e.target.checked)}
          className="mt-1"
          required
        />
        <span>
          Declaro que meu <b>Friend Code</b> é verdadeiro e compreendo que a conta pode ser{" "}
          <b>excluída</b> em caso de fraude.
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
          Autorizo o tratamento dos meus <b>dados pessoais (e-mail)</b> para autenticação, comunicação da
          plataforma e segurança, conforme a Política de Privacidade.
        </span>
      </label>

      <button
        type="submit"
        disabled={loading}
        className={`w-full text-white p-2 rounded ${loading ? "bg-yellow-400" : "bg-yellow-500 hover:bg-yellow-600"}`}
      >
        {loading ? "Enviando..." : "Cadastrar"}
      </button>

      {mensagemErro && (
        <p className="text-red-600 mt-2" aria-live="assertive">
          {mensagemErro}
        </p>
      )}
      {mensagemInfo && (
        <p className="text-green-700 mt-2" aria-live="polite">
          {mensagemInfo}
        </p>
      )}

      <p className="text-gray-600 mt-4 text-sm">
        Não recebeu o e-mail? Verifique também a pasta <b>Spam</b>.
      </p>
    </form>
  );
}
