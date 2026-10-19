/** Regras puras compartilhadas pelo servidor e pela prévia administrativa. */
export type ParticipanteElite = {
  uid: string; nome: string; pontos: number; pontos_vitoria: number; pontos_participacao: number;
  pontos_admin: number; tipo_participante: "lider" | "elite4"; optou_participar: boolean;
  ginasio_id: string; ginasio_nome: string; ginasio_tipo: string;
};
export type MembroElite = {
  uid: string; nome: string; pos: number; tipo: string;
  ginasio_origem_id?: string; ginasio_origem_nome?: string;
};
export type TrocaElite = { promovido: ParticipanteElite; rebaixado: MembroElite | null; pos: number };

export function podePontuarGinasio(participante: Record<string, unknown> | undefined, ginasioId: string) {
  return participante?.tipo_participante === "lider" && participante.optou_participar === true && participante.ginasio_id === ginasioId;
}

export function ordenarElite(a: ParticipanteElite, b: ParticipanteElite) {
  return b.pontos - a.pontos || b.pontos_vitoria - a.pontos_vitoria ||
    b.pontos_participacao - a.pontos_participacao || a.nome.localeCompare(b.nome, "pt-BR") || a.uid.localeCompare(b.uid);
}

export function planejarElite4(atuais: MembroElite[], participantes: ParticipanteElite[], vencedores?: string[]) {
  if (atuais.length > 4 || new Set(atuais.map((e) => e.uid)).size !== atuais.length ||
    new Set(atuais.map((e) => e.pos)).size !== atuais.length || atuais.some((e) => ![1, 2, 3, 4].includes(e.pos))) {
    throw new Error("A composição atual da Elite 4 tem cargos duplicados ou inválidos.");
  }
  const uidsAtuais = new Set(atuais.map((e) => e.uid));
  const elegiveis = participantes.filter((p) => p.tipo_participante === "lider" && p.optou_participar === true && !uidsAtuais.has(p.uid)).sort(ordenarElite);
  const pontos = (e: MembroElite) => participantes.find((p) => p.uid === e.uid)?.pontos || 0;
  const restantes = [...atuais].sort((a, b) => pontos(a) - pontos(b) || b.pos - a.pos || a.uid.localeCompare(b.uid));
  const vagas = [1, 2, 3, 4].filter((pos) => !atuais.some((e) => e.pos === pos));
  if (vencedores !== undefined && (vencedores.length > 4 || new Set(vencedores).size !== vencedores.length || vencedores.some((uid) => !elegiveis.some((p) => p.uid === uid)))) {
    throw new Error("Só podem ser promovidos líderes que optaram por participar e escolheram um ginásio.");
  }
  const candidatos = vencedores === undefined ? elegiveis : elegiveis.filter((p) => vencedores.includes(p.uid));
  const trocas: TrocaElite[] = [];
  for (const candidato of candidatos) {
    if (trocas.length >= 4) break;
    if (!candidato.ginasio_id || !candidato.ginasio_tipo) throw new Error(`${candidato.nome} precisa escolher um ginásio e registrar seu tipo.`);
    if (trocas.some((t) => t.promovido.ginasio_id === candidato.ginasio_id)) throw new Error("Um ginásio não pode representar dois promovidos.");
    if (vagas.length) {
      trocas.push({ promovido: candidato, rebaixado: null, pos: vagas.shift()! });
    } else {
      const rebaixado = restantes[0];
      // Empates na classificação preservam o cargo atual. O administrador pode informar o vencedor após um confronto.
      if (!rebaixado || (vencedores === undefined && candidato.pontos <= pontos(rebaixado))) break;
      if (!rebaixado.tipo) throw new Error(`O tipo de ${rebaixado.nome} precisa ser configurado antes da troca.`);
      restantes.shift();
      trocas.push({ promovido: candidato, rebaixado, pos: rebaixado.pos });
    }
  }
  const novaElite: MembroElite[] = [...restantes, ...trocas.map((t) => ({
    uid: t.promovido.uid, nome: t.promovido.nome, tipo: t.promovido.ginasio_tipo, pos: t.pos,
    ginasio_origem_id: t.promovido.ginasio_id, ginasio_origem_nome: t.promovido.ginasio_nome,
  }))].sort((a, b) => a.pos - b.pos);
  if (trocas.length && novaElite.length !== 4) throw new Error("Para formar a primeira Elite 4, quatro líderes precisam optar por participar.");
  return { novaElite, trocas };
}
