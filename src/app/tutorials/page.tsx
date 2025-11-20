// src/app/tutorials/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type TutorialKey =
  | "desafios-ginasio"
  | "liga-ro"
  | "desafio-dos-campeoes"
  | "lideranca-ginasio"
  | "guia-iniciante";

const OPTIONS: { key: TutorialKey; label: string }[] = [
  { key: "desafios-ginasio", label: "Tutorial: Desafios de Ginásio" },
  { key: "liga-ro", label: "Tutorial: Campeonato Liga RO" },
  { key: "desafio-dos-campeoes", label: "Tutorial: Desafio dos Campeões" },
  { key: "lideranca-ginasio", label: "Tutorial: Liderança de Ginásio" },
  { key: "guia-iniciante", label: "Tutorial: Guia completo para iniciante" },
];

const GOOGLE_DOC_ID = "1PVgZXgDatS4TdPD8zZ2_7c15r_YmxrgE_UkTr67itXg";
const DOC_PREVIEW = `https://docs.google.com/document/d/${GOOGLE_DOC_ID}/preview`;
const DOC_VIEW = `https://docs.google.com/document/d/${GOOGLE_DOC_ID}/edit`;
const DOC_EXPORT_PDF = `https://docs.google.com/document/d/${GOOGLE_DOC_ID}/export?format=pdf`;

export default function TutorialsPage() {
  const search = useSearchParams();
  const router = useRouter();

  const initialKey = (search.get("t") as TutorialKey) || "desafios-ginasio";
  const [selected, setSelected] = useState<TutorialKey>(initialKey);

  useEffect(() => {
    const q = (search.get("t") as TutorialKey) || "desafios-ginasio";
    if (q !== selected) setSelected(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const Title = useMemo(
    () => OPTIONS.find((o) => o.key === selected)?.label ?? "Tutoriais",
    [selected]
  );

  function onChange(key: TutorialKey) {
    setSelected(key);
    router.replace(`/tutorials?t=${key}`);
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <h1 className="text-2xl font-bold">{Title}</h1>
        <label className="flex items-center gap-2">
          <span className="text-sm text-gray-600">Selecionar tutorial:</span>
          <select
            value={selected}
            onChange={(e) => onChange(e.target.value as TutorialKey)}
            className="border rounded px-3 py-2 text-sm"
          >
            {OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      <section className="bg-white border rounded-lg p-5">
        {selected === "desafios-ginasio" && <TutorialDesafiosGinasio />}
        {selected === "liga-ro" && <TutorialLigaRO />}
        {selected === "desafio-dos-campeoes" && <TutorialDesafioDosCampeoes />}
        {selected === "lideranca-ginasio" && <TutorialLiderancaGinasio />}
        {selected === "guia-iniciante" && <TutorialGuiaIniciante />}
      </section>
    </div>
  );
}

/* =================== Conteúdos =================== */

function TutorialDesafiosGinasio() {
  return (
    <div className="space-y-4">
      <p className="text-gray-700">
        Neste tutorial você aprende como desafiar um líder de ginásio pelo site e como cadastrar o{" "}
        <b>time da temporada</b> (usado em todos os desafios dessa temporada).
      </p>

      <ol className="list-decimal pl-5 space-y-2 text-gray-800">
        <li>
          Acesse a página do ginásio e clique em <b>Desafiar líder</b>, o líder pode usar somente Pokémon que compartilham o tipo do ginásio.
        </li>
        <li>
          Use o chat para combinar <b>data</b>, <b>horário</b>, <b>local (Presencial ou Virtual)</b> e um meio de contato
          (ex.: telefone).
        </li>
        <li>
          Após a batalha, registre o resultado clicando em <b>Venci</b> ou{" "}
          <b>Fui derrotado</b>.
        </li>
        <li>
          Quando desafiante e líder registrarem o <b>mesmo resultado</b>, o sistema aplica a
          recompensa: vitória = <b>1 insígnia</b>; derrota = novo desafio liberado em{" "}
          <b>7 dias</b>.
        </li>
        <li>
          A insígnia fica registrada no seu <b>perfil</b>; combine com o líder a entrega da
          versão <b>física</b>, em caso de disputa a distância.
        </li>
      </ol>

      <div className="rounded-md border p-4 bg-indigo-50">
        <h3 className="font-semibold mb-1">Cadastro do Time da Temporada</h3>

        <p className="text-sm text-indigo-900">
          Cadastre seu time que será usado em todos os desafios da <b>temporada</b> na área de perfil do jogador (seu
          cadastro de time). Monte um time ideal para enfrentar todos os desafios, você pode adicionar apenas um Pokémon
          e adicionar os outros 5 conforme julgar necessário. Você pode apenas desafiar os líderes, usando qualquer
          Pokémon da espécie declarada.
        </p>

        <div className="mt-3 rounded-md border p-4 bg-yellow-50">
          <ul className="list-disc pl-5 text-sm text-yellow-900 space-y-1">
            <li>
              Exemplo: Declarado espécie Kyurem, pode usar qualquer Kyurem que possuir, desde que respeite a liga
              selecionada. Poderia ser Kyurem, Kyurem-Black, Kyurem-White, até mesmo mega Kyurem. Só não poderia usar uma
              variação regional do Kyurem por ser considerado outro Pokémon.
            </li>
          </ul>
        </div>
      </div>

      <div className="rounded-md border p-4 bg-yellow-50">
        <h3 className="font-semibold mb-1">Dicas rápidas</h3>
        <ul className="list-disc pl-5 text-sm text-yellow-900 space-y-1">
          <li>Use o chat do desafio para combinar horário, local e forma de contato.</li>
          <li>Respeite as regras específicas da liga e do ginásio (quando existirem).</li>
        </ul>
      </div>
    </div>
  );
}

function TutorialLigaRO() {
  return (
    <div className="space-y-4">
      <p className="text-gray-700">
        A <b>Liga RO</b> é um campeonato <b>presencial</b> que reúne jogadores qualificados e define quem representará a
        região nos desafios seguintes.
      </p>

      <ul className="list-disc pl-5 space-y-2 text-gray-800">
        <li>
          <b>Qualificação:</b> para participar, o jogador deve possuir <b>ao menos 8 insígnias</b> válidas da temporada.
        </li>
        <li>
          <b>Formato:</b> Classificatória + Top Cut
        </li>
        <li>
          <b>Fase classificatória:</b> Suíço em 4–5 rodadas (MD3), 3 pontos vitória / 1 empate / 0 derrota.

          Top Cut: Top 8 em eliminação simples em melhor de 3(MD3). Podem ser usados qualquer Pokémon, com qualquer golpes que forem aceitos na liga referente, desde que a espécie do Pokémon esteja devidamente cadastrada entre seus 6 Pokémon da temporada.
        </li>
        <li>
          <b>Premiação e ranking:</b> O campeão da liga ganha um troféu e mais a chance de enfrentar a elite 4 e entrar para o <b>Salão da Fama</b>. Os demais participantes recebem o título no histórico com a posição que obtiveram no torneio
        </li>
      </ul>

      <div className="rounded-md border p-4 bg-green-50">
        <h3 className="font-semibold mb-1">Importante</h3>
        <p className="text-sm text-green-900">
          Leve documento, insígnias (comprovantes no sistema) e o time da temporada devidamente registrado.
        </p>
      </div>
    </div>
  );
}

function TutorialDesafioDosCampeoes() {
  return (
    <div className="space-y-4">
      <p className="text-gray-700">
        O <b>Desafio dos Campeões</b> define quem é o <b>Campeão da Região</b>. O vencedor da Liga RO ganha o direito de
        desafiar a <b>Elite 4</b> e o <b>Campeão vigente</b>.
      </p>

      <ol className="list-decimal pl-5 space-y-2 text-gray-800">
        <li>
          <b>Vencer a Liga RO:</b> o campeão da liga adquire o direito de avançar ao Desafio dos Campeões.
        </li>
        <li>
          <b>Desafiar a Elite 4:</b> sequência de confrontos contra quatro treinadores de elite.
        </li>
        <li>
          <b>Duelo com o Campeão atual:</b> vencendo, você entra no <b>Hall of Fame</b> com os Pokémon utilizados e se torna
          o <b>novo Campeão da Região</b>.
        </li>
      </ol>

      <div className="rounded-md border p-4 bg-blue-50">
        <h3 className="font-semibold mb-1">Hall of Fame</h3>
        <p className="text-sm text-blue-900">
          O time do novo campeão é registrado no Hall of Fame da temporada. Esse registro é histórico e público.
        </p>
      </div>
    </div>
  );
}

function TutorialLiderancaGinasio() {
  return (
    <div className="space-y-4">
      <p className="text-gray-700">
        A liderança de ginásio é uma posição ativa. O líder mantém o ginásio, aceita desafios e pode definir regras
        internas (desde que respeitem as normas gerais da temporada).
      </p>

      <h3 className="font-semibold">Como manter o ginásio</h3>
      <ul className="list-disc pl-5 space-y-2 text-gray-800">
        <li>Cheque antes de iniciar o desafio, qual a tipagem do seu ginásio, e use somente Pokémon que compartilham <b>o mesmo tipo do ginásio</b>.</li>
        <li>Ao aceitar o desafio, confira a equipe do seu oponente, se identificar que na batalha ele usou algo não declarado, tire uma evidência e encerre a batalha.</li>
        <li>Confira o countdown de cada fase (inscrições/batalhas) na página do ginásio.</li>
        <li>Defina regras locais: partida única ou melhor de 3; prazos para marcar; local do jogo, etc.</li>
        <li>Seja claro no chat sobre datas, horários e meios de contato.</li>
      </ul>

      <h3 className="font-semibold">Como manter o ginásio</h3>
      <ul className="list-disc pl-5 space-y-2 text-gray-800">
        <li>Acompanhe os desafios pelo site e responda aos pedidos de batalha.</li>
        <li>Defina regras locais: partida única ou melhor de 3; prazos para marcar; local do jogo, etc.</li>
        <li>Seja claro no chat sobre datas, horários e meios de contato.</li>
      </ul>

      <h3 className="font-semibold">Quando perde a liderança</h3>
      <ul className="list-disc pl-5 space-y-2 text-gray-800">
        <li>Ao perder 3 batalhas seguidas.</li>
        <li>Perda por inatividade ou renuncia.</li>
      </ul>

      <h3 className="font-semibold">Responsabilidades do líder</h3>
      <ul className="list-disc pl-5 space-y-2 text-gray-800">
        <li>Aceitar desafios semanalmente.</li>
        <li>Comunicar mudanças de regras internas do ginásio com antecedência.</li>
        <li>Manter conduta esportiva e colaborar com a organização.</li>
        <li>Ajudar desafiantes a melhorar e remover dúvidas.</li>
      </ul>

      <div className="rounded-md border p-4 bg-purple-50">
        <h3 className="font-semibold mb-1">Promoção para a Elite 4</h3>
        <p className="text-sm text-purple-900">
          Antes do início da Liga RO, ocorre um torneio de líderes. Os <b>4 líderes mais bem pontuados</b> assumem as
          posições da <b>Elite 4</b> para a temporada.
        </p>
      </div>
    </div>
  );
}

function TutorialGuiaIniciante() {
  return (
    <div className="space-y-4">
      <p className="text-gray-700">
        Abaixo você encontra o <b>Guia completo para iniciante</b>. Se o documento não carregar, use os botões para abrir
        no Google Docs ou baixar em PDF.
      </p>

      <div className="flex gap-2">
        <a
          href={DOC_VIEW}
          target="_blank"
          rel="noreferrer"
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-3 py-2 rounded"
        >
          Abrir no Google Docs
        </a>
        <a
          href={DOC_EXPORT_PDF}
          target="_blank"
          rel="noreferrer"
          className="bg-gray-800 hover:bg-gray-900 text-white text-sm px-3 py-2 rounded"
        >
          Baixar PDF
        </a>
      </div>

      <div className="border rounded overflow-hidden">
        {/* Embed do Google Docs (precisa estar com permissão pública para visualizar) */}
        <iframe
          src={DOC_PREVIEW}
          className="w-full"
          style={{ height: "70vh", border: 0 }}
          title="Guia completo para iniciante"
        />
      </div>

      <p className="text-xs text-gray-500">
        Observação: apostila em produção ainda, sinta-se livre para contribuir no tutorial ou fazer sugestões”.
      </p>
    </div>
  );
}
