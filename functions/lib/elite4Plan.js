"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.podePontuarGinasio = podePontuarGinasio;
exports.ordenarElite = ordenarElite;
exports.planejarElite4 = planejarElite4;
function podePontuarGinasio(participante, ginasioId) {
    return participante?.tipo_participante === "lider" && participante.optou_participar === true && participante.ginasio_id === ginasioId;
}
function ordenarElite(a, b) {
    return b.pontos - a.pontos || b.pontos_vitoria - a.pontos_vitoria ||
        b.pontos_participacao - a.pontos_participacao || a.nome.localeCompare(b.nome, "pt-BR") || a.uid.localeCompare(b.uid);
}
function planejarElite4(atuais, participantes, vencedores) {
    if (atuais.length > 4 || new Set(atuais.map((e) => e.uid)).size !== atuais.length ||
        new Set(atuais.map((e) => e.pos)).size !== atuais.length || atuais.some((e) => ![1, 2, 3, 4].includes(e.pos))) {
        throw new Error("A composição atual da Elite 4 tem cargos duplicados ou inválidos.");
    }
    const uidsAtuais = new Set(atuais.map((e) => e.uid));
    const elegiveis = participantes.filter((p) => p.tipo_participante === "lider" && p.optou_participar === true && !uidsAtuais.has(p.uid)).sort(ordenarElite);
    const pontos = (e) => participantes.find((p) => p.uid === e.uid)?.pontos || 0;
    const restantes = [...atuais].sort((a, b) => pontos(a) - pontos(b) || b.pos - a.pos || a.uid.localeCompare(b.uid));
    const vagas = [1, 2, 3, 4].filter((pos) => !atuais.some((e) => e.pos === pos));
    if (vencedores !== undefined && (vencedores.length > 4 || new Set(vencedores).size !== vencedores.length || vencedores.some((uid) => !elegiveis.some((p) => p.uid === uid)))) {
        throw new Error("Só podem ser promovidos líderes que optaram por participar e escolheram um ginásio.");
    }
    const candidatos = vencedores === undefined ? elegiveis : elegiveis.filter((p) => vencedores.includes(p.uid));
    const trocas = [];
    for (const candidato of candidatos) {
        if (trocas.length >= 4)
            break;
        if (!candidato.ginasio_id || !candidato.ginasio_tipo)
            throw new Error(`${candidato.nome} precisa escolher um ginásio e registrar seu tipo.`);
        if (trocas.some((t) => t.promovido.ginasio_id === candidato.ginasio_id))
            throw new Error("Um ginásio não pode representar dois promovidos.");
        if (vagas.length) {
            trocas.push({ promovido: candidato, rebaixado: null, pos: vagas.shift() });
        }
        else {
            const rebaixado = restantes[0];
            // Empates na classificação preservam o cargo atual. O administrador pode informar o vencedor após um confronto.
            if (!rebaixado || (vencedores === undefined && candidato.pontos <= pontos(rebaixado)))
                break;
            if (!rebaixado.tipo)
                throw new Error(`O tipo de ${rebaixado.nome} precisa ser configurado antes da troca.`);
            restantes.shift();
            trocas.push({ promovido: candidato, rebaixado, pos: rebaixado.pos });
        }
    }
    const novaElite = [...restantes, ...trocas.map((t) => ({
            uid: t.promovido.uid, nome: t.promovido.nome, tipo: t.promovido.ginasio_tipo, pos: t.pos,
            ginasio_origem_id: t.promovido.ginasio_id, ginasio_origem_nome: t.promovido.ginasio_nome,
        }))].sort((a, b) => a.pos - b.pos);
    if (trocas.length && novaElite.length !== 4)
        throw new Error("Para formar a primeira Elite 4, quatro líderes precisam optar por participar.");
    return { novaElite, trocas };
}
