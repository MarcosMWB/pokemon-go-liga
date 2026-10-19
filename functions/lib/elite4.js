"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminFinalizeElite4 = void 0;
exports.aplicarPromocaoElite4 = aplicarPromocaoElite4;
const https_1 = require("firebase-functions/v2/https");
const adminSdk_1 = require("./adminSdk");
function classificado(data, fallbackUid = "") {
    const numero = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
    return {
        uid: String(data.uid || data.usuario_uid || fallbackUid), nome: String(data.nome || ""),
        pontos: numero(data.pontos), pontos_vitoria: numero(data.pontos_vitoria),
        pontos_participacao: numero(data.pontos_participacao), pontos_admin: numero(data.pontos_admin),
        tipo_participante: data.tipo_participante === "elite4" ? "elite4" : "lider",
        ginasio_id: String(data.ginasio_id || ""), ginasio_nome: String(data.ginasio_nome || ""),
    };
}
/** A transação grava cargos, mandatos, ginásios, disputas e agenda juntos. */
async function aplicarPromocaoElite4(campeonatoId, adminUid, selecionados) {
    return adminSdk_1.db.runTransaction(async (tx) => {
        const campeonatoRef = adminSdk_1.db.doc(`campeonatos_elite4/${campeonatoId}`);
        const campeonatoSnap = await tx.get(campeonatoRef);
        if (!campeonatoSnap.exists)
            throw new https_1.HttpsError("not-found", "Disputa não encontrada.");
        const campeonato = campeonatoSnap.data();
        if (campeonato.promocao_aplicada === true) {
            return { ok: true, jaAplicada: true, ginasiosLiberados: campeonato.ginasios_liberados || [], top4: campeonato.elite4_definida || [] };
        }
        if (!["aberto", "fechado"].includes(campeonato.status))
            throw new https_1.HttpsError("failed-precondition", "Estado da disputa inválido.");
        const liga = String(campeonato.liga || "");
        if (!liga)
            throw new https_1.HttpsError("failed-precondition", "A disputa não tem uma liga definida.");
        const [participantes, resultados, atuais, mandatos, ginasios, temporadas, config, disputasDaLiga] = await Promise.all([
            tx.get(campeonatoRef.collection("participantes")),
            tx.get(adminSdk_1.db.collection("campeonatos_elite4_resultados").where("campeonato_id", "==", campeonatoId)),
            tx.get(adminSdk_1.db.collection("elite4").where("liga", "==", liga)),
            tx.get(adminSdk_1.db.collection("elite4_mandatos").where("liga", "==", liga)),
            tx.get(adminSdk_1.db.collection("ginasios")),
            tx.get(adminSdk_1.db.collection("temporadas").where("ativa", "==", true)),
            tx.get(adminSdk_1.db.doc("variables/global")),
            tx.get(adminSdk_1.db.collection("campeonatos_elite4").where("liga", "==", liga)),
        ]);
        const millis = (value) => typeof value?.toMillis === "function" ? value.toMillis() : Number(value) || 0;
        if (disputasDaLiga.docs.some((item) => item.id !== campeonatoId &&
            millis(item.get("createdAt")) > millis(campeonato.createdAt) &&
            (item.get("status") === "aberto" || item.get("promocao_aplicada") === true))) {
            throw new https_1.HttpsError("failed-precondition", "Já existe uma disputa mais recente nesta liga. Revise a composição atual antes de aplicar um resultado antigo.");
        }
        const resultadoAnterior = resultados.docs.sort((a, b) => millis(b.get("appliedAt")) - millis(a.get("appliedAt")))[0];
        const arquivado = resultadoAnterior?.data();
        if (campeonato.status === "fechado" && !arquivado?.top4?.length) {
            throw new https_1.HttpsError("failed-precondition", "A disputa encerrada não tem os quatro classificados registrados.");
        }
        const fonte = campeonato.status === "fechado"
            ? (Array.isArray(arquivado?.ranking) ? arquivado.ranking : arquivado.top4)
            : participantes.docs.map((item) => ({ ...item.data(), uid: item.get("usuario_uid") || item.id }));
        const porUid = new Map();
        for (const item of fonte) {
            const pessoa = classificado(item);
            if (pessoa.uid && !pessoa.uid.includes("/") && (!porUid.has(pessoa.uid) || porUid.get(pessoa.uid).pontos < pessoa.pontos))
                porUid.set(pessoa.uid, pessoa);
        }
        const perfis = await Promise.all([...porUid.keys()].map((uid) => tx.get(adminSdk_1.db.doc(`usuarios/${uid}`))));
        for (const perfil of perfis) {
            const pessoa = porUid.get(perfil.id);
            pessoa.nome = String(perfil.get("nome") || pessoa.nome || pessoa.uid);
        }
        const ranking = [...porUid.values()].sort((a, b) => b.pontos - a.pontos || b.pontos_vitoria - a.pontos_vitoria ||
            b.pontos_participacao - a.pontos_participacao || a.nome.localeCompare(b.nome, "pt-BR"));
        const escolhas = selecionados || (campeonato.status === "fechado"
            ? arquivado.top4.map((item) => String(item.uid))
            : ranking.filter((item) => item.tipo_participante === "lider").slice(0, 4).map((item) => item.uid));
        if (escolhas.length !== 4 || new Set(escolhas).size !== 4 || escolhas.some((uid) => !porUid.has(uid))) {
            throw new https_1.HttpsError("invalid-argument", "Selecione exatamente quatro participantes diferentes.");
        }
        const escolhidos = escolhas.map((uid, index) => ({ ...porUid.get(uid), pos: index + 1 }));
        const ginasiosDaLiga = ginasios.docs.filter((gym) => (gym.get("liga") || gym.get("liga_nome")) === liga);
        const uidsAtuais = new Set(atuais.docs.map((item) => item.get("uid")));
        for (const pessoa of escolhidos) {
            if (!uidsAtuais.has(pessoa.uid) && !ginasiosDaLiga.some((gym) => gym.get("lider_uid") === pessoa.uid)) {
                throw new https_1.HttpsError("failed-precondition", `${pessoa.nome} já não é líder nem membro da Elite 4 nesta liga. Revise os quatro escolhidos.`);
            }
        }
        const liberados = ginasiosDaLiga.filter((gym) => escolhas.includes(gym.get("lider_uid")));
        const detalhes = await Promise.all(liberados.map(async (gym) => {
            const [liderancas, disputas, desafios] = await Promise.all([
                tx.get(adminSdk_1.db.collection("ginasios_liderancas").where("ginasio_id", "==", gym.id)),
                tx.get(adminSdk_1.db.collection("disputas_ginasio").where("ginasio_id", "==", gym.id)),
                tx.get(adminSdk_1.db.collection("desafios_ginasio").where("ginasio_id", "==", gym.id)),
            ]);
            const ativas = disputas.docs.filter((item) => ["inscricoes", "batalhando"].includes(item.get("status")));
            if (ativas.length > 1)
                throw new https_1.HttpsError("failed-precondition", `Há mais de uma disputa ativa em ${gym.get("nome") || gym.id}. Regularize esse ginásio primeiro.`);
            return { gym, liderancas, ativa: ativas[0], desafios };
        }));
        const quantidadeEscritas = atuais.size + mandatos.size + 12 + detalhes.reduce((total, item) => total + item.liderancas.size + item.desafios.size + 3, 0);
        if (quantidadeEscritas > 450)
            throw new https_1.HttpsError("resource-exhausted", "Há muitos registros pendentes para esta promoção. Solicite uma revisão administrativa.");
        // Todas as leituras devem terminar antes da primeira escrita da transação.
        const agora = Date.now();
        const tempoHoras = Number(String(config.get("tempo_inscricoes") || 0).replace(",", "."));
        const inicioDisputas = agora + (Number.isFinite(tempoHoras) ? Math.max(0, tempoHoras) * 3600000 : 0);
        const temporada = temporadas.docs[0];
        const temporadaId = String(campeonato.temporada_id || temporada?.id || "");
        const temporadaNome = String(campeonato.temporada_nome || temporada?.get("nome") || "");
        for (const anterior of atuais.docs)
            tx.delete(anterior.ref);
        for (const mandato of mandatos.docs) {
            if (mandato.get("fim") != null)
                continue;
            if (escolhas.includes(mandato.get("usuario_uid"))) {
                tx.update(mandato.ref, { pos: escolhas.indexOf(mandato.get("usuario_uid")) + 1 });
            }
            else {
                tx.update(mandato.ref, { fim: agora, motivo_fim: "nova_elite4", campeonato_fim_id: campeonatoId });
            }
        }
        for (const pessoa of escolhidos) {
            tx.set(adminSdk_1.db.doc(`elite4/${encodeURIComponent(liga)}_${pessoa.pos}`), {
                uid: pessoa.uid, nome: pessoa.nome, liga, pos: pessoa.pos, campeonato_id: campeonatoId, updatedAt: agora,
            });
            if (!mandatos.docs.some((item) => item.get("usuario_uid") === pessoa.uid && item.get("fim") == null)) {
                tx.set(adminSdk_1.db.doc(`elite4_mandatos/${campeonatoId}_${pessoa.uid}`), {
                    usuario_uid: pessoa.uid, liga, pos: pessoa.pos, inicio: agora, fim: null,
                    campeonato_id: campeonatoId, temporada_id: temporadaId, temporada_nome: temporadaNome,
                });
            }
        }
        const resumoGinasios = detalhes.map(({ gym, liderancas, ativa, desafios }) => {
            tx.update(gym.ref, { lider_uid: "", em_disputa: true, derrotas_seguidas: 0 });
            for (const lideranca of liderancas.docs) {
                if (lideranca.get("fim") == null && lideranca.get("endedAt") == null) {
                    tx.update(lideranca.ref, { fim: agora, endedAt: agora, motivo_fim: "promocao_elite4", campeonato_id: campeonatoId });
                }
            }
            for (const desafio of desafios.docs) {
                if (desafio.get("status") === "pendente" && desafio.get("lider_uid") === gym.get("lider_uid")) {
                    tx.update(desafio.ref, { status: "cancelado", motivo_cancelamento: "lider_promovido_elite4", fechadoEm: agora });
                }
            }
            const disputaRef = ativa?.ref || adminSdk_1.db.doc(`disputas_ginasio/elite4_${campeonatoId}_${gym.id}`);
            if (!ativa) {
                tx.create(disputaRef, {
                    ginasio_id: gym.id, status: "inscricoes", tipo_original: gym.get("tipo") || "",
                    lider_anterior_uid: gym.get("lider_uid"), liga, temporada_id: temporadaId,
                    temporada_nome: temporadaNome, origem: "promocao_elite4", campeonato_elite4_id: campeonatoId,
                    createdAt: agora, nextStartAtMs: inicioDisputas,
                });
            }
            if (!ativa || (ativa.get("status") === "inscricoes" && !ativa.get("nextStartAtMs"))) {
                tx.set(adminSdk_1.db.doc(`jobs_disputas/elite4_${campeonatoId}_${gym.id}`), {
                    acao: "iniciar_disputa", status: "pendente", ginasio_id: gym.id, disputa_id: disputaRef.id,
                    origem: "promocao_elite4", runAtMs: inicioDisputas, createdAt: agora,
                });
                if (ativa)
                    tx.update(disputaRef, { nextStartAtMs: inicioDisputas });
            }
            return { id: gym.id, nome: String(gym.get("nome") || gym.id), disputa_id: disputaRef.id };
        });
        const resultadoRef = resultadoAnterior?.ref || adminSdk_1.db.doc(`campeonatos_elite4_resultados/${campeonatoId}`);
        tx.set(resultadoRef, {
            campeonato_id: campeonatoId, liga, ranking: ranking.map((item, index) => ({ ...item, pos: index + 1 })),
            top4: escolhidos, top4_classificacao: arquivado?.top4_classificacao || arquivado?.top4 || escolhidos,
            appliedAt: agora, promocao_aplicada: true, admin_uid: adminUid,
            elite4_anterior: atuais.docs.map((item) => ({ id: item.id, ...item.data() })), ginasios_liberados: resumoGinasios,
        }, { merge: true });
        tx.update(campeonatoRef, {
            status: "fechado", ativo: false, closedAt: campeonato.closedAt || agora,
            promocao_aplicada: true, promocao_aplicada_at: agora, promocao_admin_uid: adminUid,
            resultado_id: resultadoRef.id, elite4_definida: escolhidos, ginasios_liberados: resumoGinasios,
        });
        return { ok: true, jaAplicada: false, top4: escolhidos, ginasiosLiberados: resumoGinasios };
    });
}
exports.adminFinalizeElite4 = (0, https_1.onCall)({ region: "southamerica-east1" }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid)
        throw new https_1.HttpsError("unauthenticated", "Faça login.");
    if (!(await adminSdk_1.db.doc(`superusers/${uid}`).get()).exists)
        throw new https_1.HttpsError("permission-denied", "Apenas administradores podem definir a Elite 4.");
    const campeonatoId = request.data?.campeonatoId;
    const selecionados = request.data?.selecionados;
    if (typeof campeonatoId !== "string" || !campeonatoId || campeonatoId.includes("/"))
        throw new https_1.HttpsError("invalid-argument", "Informe a disputa.");
    if (selecionados !== undefined && (!Array.isArray(selecionados) || selecionados.some((item) => typeof item !== "string" || !item || item.includes("/")))) {
        throw new https_1.HttpsError("invalid-argument", "Seleção de participantes inválida.");
    }
    return aplicarPromocaoElite4(campeonatoId, uid, selecionados);
});
