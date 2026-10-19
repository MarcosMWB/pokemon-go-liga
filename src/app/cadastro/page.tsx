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
  const [receberNotificacoes, setReceberNotificacoes] = useState(true);

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
      // 1) cria usuário no Auth (o Firebase vai autenticar automaticamente aqui)
      const cred = await createUserWithEmailAndPassword(
        auth,
        email.trim(),
        senha
      );
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
            createdAtMs: Date.now(),
            consentimentos: {
              versao: "v2-2026-10-19",
              dadosSensiveisEmail: true,
              declaracaoFriendCodeVerdadeiro: true,
              timestamp: serverTimestamp(),
              userAgent:
                typeof navigator !== "undefined" ? navigator.userAgent : null,
            },
            notifications: {
              enabled: receberNotificacoes,
              updatedAt: serverTimestamp(),
            },
          },
          { merge: true }
        );
      } catch (w) {
        console.warn("Falha ao gravar usuarios_private:", w);
      }

      // 3) envia e-mail de verificação (sem redirecionamento customizado)
      try {
        await sendEmailVerification(user);
      } catch (e: any) {
        const code = e?.code || "";
        if (code === "auth/too-many-requests") {
          setMensagemErro(
            "Muitas tentativas de verificação. Tente novamente mais tarde."
          );
        } else if (code === "auth/network-request-failed") {
          setMensagemErro(
            "Falha de rede ao enviar o e-mail. Verifique sua conexão."
          );
        } else {
          console.error("sendEmailVerification erro:", code, e?.message);
          setMensagemErro(
            "Falha ao enviar o e-mail de verificação. Tente novamente."
          );
        }
        setLoading(false);
        return;
      }

      // 4) mensagem e FORÇA logout antes de qualquer navegação
      setMensagemInfo(
        `Enviamos um e-mail de verificação para ${email}. Confirme para poder acessar. ` +
          `Confira também a caixa de SPAM.`
      );

      // aqui garantimos que ele NÃO fica logado na app
      await signOut(auth);

      // manda para a tela de login com um flagzinho pra você mostrar aviso lá
      router.replace(
        `/login?verify=1&email=${encodeURIComponent(email.trim())}`
      );
    } catch (err) {
      setMensagemErro(mapSignupError(err));
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mx-auto my-4 w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
      <h1 className="mb-2 text-2xl font-bold text-slate-950">Criar conta na Liga</h1>
      <p className="mb-6 text-base leading-7 text-slate-700">Preencha seus dados para participar dos desafios. Depois, confirme seu e-mail para acessar sua conta.</p>

      <label htmlFor="cadastro-friend-code" className="mb-1 block text-base font-semibold text-slate-800">Código de amizade do Pokémon GO</label>
      <input
        id="cadastro-friend-code"
        type="text"
        placeholder="Código do treinador: 9999 0000 9999"
        required
        value={friendCode}
        onChange={(e) => setFriendCode(e.target.value)}
        className="mb-1 min-h-12 w-full rounded-lg border border-slate-400 p-3 text-base"
        autoComplete="off"
        inputMode="numeric"
      />
      <p className="mb-4 text-sm leading-6 text-slate-600">No jogo, abra seu perfil, toque em “Amigos” e depois em “Adicionar amigo” para encontrar o código.</p>

      <label htmlFor="cadastro-nome" className="mb-1 block text-base font-semibold text-slate-800">Como devemos chamar você?</label>
      <input
        id="cadastro-nome"
        type="text"
        placeholder="Nome"
        required
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        className="mb-4 min-h-12 w-full rounded-lg border border-slate-400 p-3 text-base"
        autoComplete="name"
      />

      <label htmlFor="cadastro-email" className="mb-1 block text-base font-semibold text-slate-800">Seu e-mail</label>
      <input
        id="cadastro-email"
        type="email"
        placeholder="E-mail"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="mb-4 min-h-12 w-full rounded-lg border border-slate-400 p-3 text-base"
        autoComplete="email"
        inputMode="email"
      />

      <label htmlFor="cadastro-senha" className="mb-1 block text-base font-semibold text-slate-800">Crie uma senha</label>
      <div className="relative mb-4 w-full">
        <input
          id="cadastro-senha"
          type={mostrarSenha ? "text" : "password"}
          placeholder="Senha"
          required
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          className="min-h-12 w-full rounded-lg border border-slate-400 p-3 pr-14 text-base"
          autoComplete="new-password"
        />
        <button
          type="button"
          onClick={() => setMostrarSenha(!mostrarSenha)}
          className="absolute right-1 top-1/2 flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded text-slate-700 hover:bg-slate-100"
          aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
        >
          {mostrarSenha ? "🙈" : "👁️"}
        </button>
      </div>

      {/* Consentimentos */}
      <label className="mb-3 flex min-h-11 items-start gap-3 text-base leading-6 text-slate-800">
        <input
          type="checkbox"
          checked={declaraFriendCode}
          onChange={(e) => setDeclaraFriendCode(e.target.checked)}
          className="mt-1 h-5 w-5 shrink-0"
          required
        />
        <span>
          Declaro que meu <b>Friend Code</b> é verdadeiro e compreendo que a
          conta pode ser <b>excluída</b> em caso de fraude.
        </span>
      </label>

      <label className="mb-4 flex min-h-11 items-start gap-3 text-base leading-6 text-slate-800">
        <input
          type="checkbox"
          checked={aceitoDados}
          onChange={(e) => setAceitoDados(e.target.checked)}
          className="mt-1 h-5 w-5 shrink-0"
          required
        />
        <span>
          Autorizo o tratamento dos meus <b>dados pessoais (e-mail)</b> para
          autenticação, segurança e funcionamento da conta, conforme a
          Política de Privacidade.
        </span>
      </label>

      <label className="mb-4 flex min-h-12 items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-base leading-6 text-slate-800">
        <input
          type="checkbox"
          checked={receberNotificacoes}
          onChange={(e) => setReceberNotificacoes(e.target.checked)}
          className="mt-1 h-5 w-5 shrink-0"
        />
        <span>
          Quero receber notificações no site sobre batalhas, desafios e insígnias.
          Posso alterar essa opção no meu perfil.
        </span>
      </label>

      <button
        type="submit"
        disabled={loading}
        className={`min-h-12 w-full rounded-lg p-3 text-base font-bold text-white ${
          loading ? "bg-yellow-400" : "bg-yellow-500 hover:bg-yellow-600"
        }`}
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
