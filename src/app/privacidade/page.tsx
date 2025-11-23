// src/app/privacidade/page.tsx
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description:
    "Política de privacidade, cookies e consentimento da Liga Pokémon GO - Região Oceânica.",
  robots: { index: true, follow: true },
};

const LAST_UPDATED = "23/11/2025";
const SUPPORT_EMAIL =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "defina NEXT_PUBLIC_SUPPORT_EMAIL";

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xl font-semibold text-slate-900 mb-2">{children}</h2>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-slate-700 mb-3">{children}</p>;
}

function Ul({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700 mb-3">{children}</ul>;
}

/** Botões para gerenciar consentimento diretamente nesta página */
function ManageConsentButtons() {
  "use client";

  type ConsentState = "granted" | "denied";
  type Stored = {
    set: boolean;
    ad_storage: ConsentState;
    analytics_storage: ConsentState;
    ad_user_data: ConsentState;
    ad_personalization: ConsentState;
  };

  const KEY = "consent_v2";

  function applyConsent(c: Stored) {
  (window as any).dataLayer = (window as any).dataLayer || [];
  const dl = (window as any).dataLayer;

  // aceita qualquer quantidade de argumentos
  function gtag(...args: any[]) {
    dl.push(args);
  }

  gtag("consent", "update", {
    ad_storage: c.ad_storage,
    analytics_storage: c.analytics_storage,
    ad_user_data: c.ad_user_data,
    ad_personalization: c.ad_personalization,
    functionality_storage: "granted",
    security_storage: "granted",
  });
}

  function acceptAll() {
    const choice: Stored = {
      set: true,
      ad_storage: "granted",
      analytics_storage: "granted",
      ad_user_data: "granted",
      ad_personalization: "granted",
    };
    localStorage.setItem(KEY, JSON.stringify(choice));
    applyConsent(choice);
    alert("Preferências salvas: tudo aceito.");
  }

  function essentialsOnly() {
    const choice: Stored = {
      set: true,
      ad_storage: "denied",
      analytics_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    };
    localStorage.setItem(KEY, JSON.stringify(choice));
    applyConsent(choice);
    alert("Preferências salvas: apenas essenciais.");
  }

  function resetChoice() {
    localStorage.removeItem(KEY);
    alert("Preferências limpas. O banner voltará a aparecer na próxima navegação.");
  }

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <button
        onClick={essentialsOnly}
        className="px-3 py-1.5 rounded border text-sm"
      >
        Manter só essenciais
      </button>
      <button
        onClick={acceptAll}
        className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm"
      >
        Aceitar tudo
      </button>
      <button
        onClick={resetChoice}
        className="px-3 py-1.5 rounded border text-sm"
      >
        Limpar preferência
      </button>
      <Link
        href="/"
        className="px-3 py-1.5 rounded border text-sm"
      >
        Voltar à página inicial
      </Link>
    </div>
  );
}

export default function PrivacyPage() {
  const emailShown =
    SUPPORT_EMAIL === "defina NEXT_PUBLIC_SUPPORT_EMAIL"
      ? "defina NEXT_PUBLIC_SUPPORT_EMAIL (env var)"
      : SUPPORT_EMAIL;

  return (
    <div className="max-w-3xl mx-auto bg-white p-6 md:p-8 rounded shadow">
      <h1 className="text-2xl font-bold text-slate-900 mb-2">Política de Privacidade</h1>
      <p className="text-xs text-slate-500 mb-6">Última atualização: {LAST_UPDATED}</p>

      <H2>Quem somos</H2>
      <P>
        Este site é um sistema comunitário da Liga Pokémon GO – Região Oceânica
        (projeto de fãs, sem vínculo oficial com a The Pokémon Company, Niantic ou Nintendo).
      </P>

      <H2>Dados que tratamos</H2>
      <Ul>
        <li>Conta de acesso (e-mail, nome) via autenticação do Google/Firebase.</li>
        <li>Dados de jogo fornecidos por você (nickname, Friend Code, ligas, equipes, pontuação, presença).</li>
        <li>Registros de uso técnicos coletados automaticamente pelo provedor de hospedagem (p. ex., IP, user-agent) para segurança e estatísticas agregadas.</li>
        <li>Cookies/armazenamentos do navegador para manter a sessão e lembrar preferências de consentimento.</li>
      </Ul>

      <H2>Finalidades e bases legais (LGPD)</H2>
      <Ul>
        <li>Executar as funcionalidades do site e do campeonato. Base: execução de contrato e legítimo interesse.</li>
        <li>Segurança, prevenção a fraudes e integridade das disputas. Base: legítimo interesse.</li>
        <li>Métricas e anúncios do Google (quando consentidos). Base: consentimento.</li>
      </Ul>

      <H2>Cookies e consentimento</H2>
      <P>
        Usamos Consent Mode v2. Por padrão, apenas armazenamento essencial fica ativo.
        Você pode aceitar tudo ou manter só o essencial. Suas escolhas são salvas localmente
        e podem ser alteradas abaixo.
      </P>
      <ManageConsentButtons />

      <H2>Anúncios do Google</H2>
      <P>
        Exibimos anúncios do Google AdSense. O Google pode usar cookies e identificadores para
        entregar e medir anúncios. Sem seu consentimento, os anúncios são não personalizados.
        Saiba mais nas políticas do Google para sites parceiros.
      </P>

      <H2>Compartilhamento</H2>
      <Ul>
        <li>Fornecedores de infraestrutura: Vercel (hospedagem), Google/Firebase (auth, banco de dados).</li>
        <li>Google AdSense para exibição de anúncios (conforme consentimento).</li>
        <li>Autoridades públicas quando exigido por lei.</li>
      </Ul>

      <H2>Seus direitos</H2>
      <P>
        Você pode solicitar acesso, correção, portabilidade, anonimização, exclusão dos dados,
        bem como revogar consentimentos. Para exercer, envie um e-mail para {emailShown}.
      </P>

      <H2>Menores</H2>
      <P>
        O site não é dirigido a menores de 13 anos. Se você é responsável e acredita que um menor
        nos forneceu dados, solicite a remoção pelo e-mail de contato.
      </P>

      <H2>Retenção</H2>
      <P>
        Mantemos dados pelo tempo necessário às finalidades acima e conforme requisitos legais.
        Ao excluir a conta, apagamos ou anonimizamos o que não for necessário manter por obrigação legal.
      </P>

      <H2>Contato</H2>
      <P>
        Dúvidas ou solicitações: {emailShown}. Recomendações: defina a variável{" "}
        <code className="bg-slate-100 px-1 rounded">NEXT_PUBLIC_SUPPORT_EMAIL</code> no Vercel para exibir o e-mail correto aqui.
      </P>

      <H2>Atualizações</H2>
      <P>
        Podemos atualizar esta política. A data no topo indica a versão vigente.
      </P>
    </div>
  );
}
