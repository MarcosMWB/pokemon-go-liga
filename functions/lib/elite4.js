"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminFinalizeElite4 = exports.setElite4Participation = void 0;
exports.aplicarPromocaoElite4 = aplicarPromocaoElite4;
const https_1 = require("firebase-functions/v2/https");
const adminSdk_1 = require("./adminSdk");
const elite4Plan_1 = require("./elite4Plan");
function normalizar(data, fallbackUid = "") {
    const numero = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
    return {
        uid: String(data.uid || data.usuario_uid || fallbackUid), nome: String(data.nome || ""),
        pontos: numero(data.pontos), pontos_vitoria: numero(data.pontos_vitoria), pontos_participacao: numero(data.pontos_participacao), pontos_admin: numero(data.pontos_admin),
        tipo_participante: data.tipo_participante === "elite4" ? "elite4" : "lider", optou_participar: data.optou_participar === true,
        ginasio_id: String(data.ginasio_id || ""), ginasio_nome: String(data.ginasio_nome || ""), ginasio_tipo: String(data.ginasio_tipo || ""),
    };
}
function idValido(value) { return typeof value === "string" && value.length > 0 && !value.includes("/"); }
exports.setElite4Participation = (0, https_1.onCall)({ region: "southamerica-east1" }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid)
        throw new https_1.HttpsError("unauthenticated", "Faça login.");
    const { campeonatoId, participar, ginasioId } = request.data || {};
    if (!idValido(campeonatoId) || typeof participar !== "boolean" || (participar && !idValido(ginasioId)))
        throw new https_1.HttpsError("invalid-argument", "Informe sua escolha e o ginásio que irá representar.");
    return adminSdk_1.db.runTransaction(async (tx) => {
        const campRef = adminSdk_1.db.doc(`campeonatos_elite4/${campeonatoId}`);
        const partRef = campRef.collection("participantes").doc(uid);
        const [camp, part, meusGinasios] = await Promise.all([
            tx.get(campRef), tx.get(partRef), tx.get(adminSdk_1.db.collection("ginasios").where("lider_uid", "==", uid)),
        ]);
        if (!camp.exists || camp.get("status") !== "aberto")
            throw new https_1.HttpsError("failed-precondition", "Esta disputa não está aberta.");
        const elites = await tx.get(adminSdk_1.db.collection("elite4").where("liga", "==", camp.get("liga")));
        if (elites.docs.some((e) => e.get("uid") === uid))
            throw new https_1.HttpsError("failed-precondition", "Você já ocupa um cargo da Elite 4 nesta liga e permanece no ranking dos membros atuais.");
        const meusNaLiga = meusGinasios.docs.filter((g) => (g.get("liga") || g.get("liga_nome")) === camp.get("liga"));
        if (!meusNaLiga.length)
            throw new https_1.HttpsError("permission-denied", "Você precisa ser líder de um ginásio desta liga.");
        const gym = meusNaLiga.find((g) => g.id === ginasioId);
        if (participar && (!gym || gym.get("em_disputa") === true || !gym.get("tipo")))
            throw new https_1.HttpsError("failed-precondition", "Escolha um ginásio estável que você lidera e que já tenha um tipo definido.");
        const mudouGinasio = participar && part.exists && part.get("ginasio_id") !== ginasioId;
        const agora = Date.now();
        const fields = {
            campeonato_id: campeonatoId, usuario_uid: uid, liga: camp.get("liga"), tipo_participante: "lider",
            optou_participar: participar, escolha_atualizada_em: agora,
            ...(participar ? { ginasio_id: gym.id, ginasio_nome: gym.get("nome") || gym.id, ginasio_tipo: gym.get("tipo") } : {}),
            ...(!part.exists || mudouGinasio ? { pontos: 0, pontos_vitoria: 0, pontos_participacao: 0, pontos_admin: 0 } : {}),
            ...(!part.exists ? { createdAt: agora, ginasio_id: participar ? gym.id : "" } : {}),
        };
        tx.set(partRef, fields, { merge: true });
        tx.create(adminSdk_1.db.collection("elite4_auditoria").doc(), {
            acao: "preferencia_participacao", usuario_uid: uid, campeonato_id: campeonatoId, createdAt: agora,
            antes: part.exists ? part.data() : null, depois: fields,
        });
        return { ok: true, participar, pontosReiniciados: mudouGinasio };
    });
});
/** Só o ginásio inscrito muda de líder. Outros ginásios do mesmo jogador permanecem intactos. */
async function aplicarPromocaoElite4(campeonatoId, adminUid, vencedores) {
    return adminSdk_1.db.runTransaction(async (tx) => {
        const campRef = adminSdk_1.db.doc(`campeonatos_elite4/${campeonatoId}`);
        const camp = await tx.get(campRef);
        if (!camp.exists)
            throw new https_1.HttpsError("not-found", "Disputa não encontrada.");
        if (camp.get("promocao_aplicada") === true)
            return { ok: true, jaAplicada: true, top4: camp.get("elite4_definida") || [], ginasiosLiberados: camp.get("ginasios_liberados") || [], ginasiosTransferidos: camp.get("ginasios_transferidos") || [] };
        if (!["aberto", "fechado"].includes(camp.get("status")))
            throw new https_1.HttpsError("failed-precondition", "Estado da disputa inválido.");
        const desafiosEliteAbertos = await tx.get(adminSdk_1.db.collection("desafios_elite4")
            .where("campeonato_id", "==", campeonatoId)
            .where("status", "in", ["pendente", "aceito", "resultado_parcial", "contestado"]));
        if (!desafiosEliteAbertos.empty)
            throw new https_1.HttpsError("failed-precondition", "Resolva ou aguarde o encerramento de todos os desafios da Elite 4 antes de finalizar a temporada.");
        const liga = String(camp.get("liga") || "");
        if (!liga)
            throw new https_1.HttpsError("failed-precondition", "A disputa não tem liga definida.");
        const [partSnap, resultSnap, atuais, mandatos, gyms, temporadas, config, outros] = await Promise.all([
            tx.get(campRef.collection("participantes")), tx.get(adminSdk_1.db.collection("campeonatos_elite4_resultados").where("campeonato_id", "==", campeonatoId)),
            tx.get(adminSdk_1.db.collection("elite4").where("liga", "==", liga)), tx.get(adminSdk_1.db.collection("elite4_mandatos").where("liga", "==", liga)),
            tx.get(adminSdk_1.db.collection("ginasios")), tx.get(adminSdk_1.db.collection("temporadas").where("ativa", "==", true)), tx.get(adminSdk_1.db.doc("variables/global")),
            tx.get(adminSdk_1.db.collection("campeonatos_elite4").where("liga", "==", liga)),
        ]);
        const millis = (v) => typeof v?.toMillis === "function" ? v.toMillis() : Number(v) || 0;
        if (outros.docs.some((d) => d.id !== campeonatoId && millis(d.get("createdAt")) > millis(camp.get("createdAt")) && (d.get("status") === "aberto" || d.get("promocao_aplicada") === true)))
            throw new https_1.HttpsError("failed-precondition", "Já existe uma disputa mais recente nesta liga.");
        const resultadoAnterior = resultSnap.docs.sort((a, b) => millis(b.get("appliedAt")) - millis(a.get("appliedAt")))[0];
        const porUid = new Map();
        for (const d of partSnap.docs) {
            const p = normalizar(d.data(), d.id);
            if (idValido(p.uid))
                porUid.set(p.uid, p);
        }
        const perfis = await Promise.all([...new Set([...porUid.keys(), ...atuais.docs.map((d) => String(d.get("uid")))])].map((uid) => tx.get(adminSdk_1.db.doc(`usuarios/${uid}`))));
        const nomes = new Map(perfis.map((d) => [d.id, String(d.get("nome") || d.id)]));
        for (const p of porUid.values()) {
            p.nome = nomes.get(p.uid) || p.nome || p.uid;
            const gym = gyms.docs.find((g) => g.id === p.ginasio_id);
            p.ginasio_nome = p.ginasio_nome || String(gym?.get("nome") || "");
        }
        const eliteAtual = atuais.docs.map((d) => ({
            uid: String(d.get("uid")), nome: nomes.get(d.get("uid")) || d.get("nome") || d.get("uid"), pos: Number(d.get("pos")),
            tipo: String(d.get("tipo") || ""), ginasio_origem_id: String(d.get("ginasio_origem_id") || ""), ginasio_origem_nome: String(d.get("ginasio_origem_nome") || ""),
        }));
        const ranking = [...porUid.values()].sort(elite4Plan_1.ordenarElite);
        let plano;
        try {
            plano = (0, elite4Plan_1.planejarElite4)(eliteAtual, ranking, vencedores);
        }
        catch (error) {
            throw new https_1.HttpsError("failed-precondition", error.message);
        }
        const detalhes = await Promise.all(plano.trocas.map(async (troca) => {
            const gym = gyms.docs.find((g) => g.id === troca.promovido.ginasio_id);
            if (!gym || gym.get("lider_uid") !== troca.promovido.uid || (gym.get("liga") || gym.get("liga_nome")) !== liga || gym.get("tipo") !== troca.promovido.ginasio_tipo)
                throw new https_1.HttpsError("failed-precondition", `O ginásio inscrito por ${troca.promovido.nome} mudou. Atualize a inscrição antes de encerrar.`);
            const [historico, disputas, desafios] = await Promise.all([
                tx.get(adminSdk_1.db.collection("ginasios_liderancas").where("ginasio_id", "==", gym.id)), tx.get(adminSdk_1.db.collection("disputas_ginasio").where("ginasio_id", "==", gym.id)),
                tx.get(adminSdk_1.db.collection("desafios_ginasio").where("ginasio_id", "==", gym.id)),
            ]);
            if (disputas.docs.some((d) => ["inscricoes", "batalhando"].includes(d.get("status"))))
                throw new https_1.HttpsError("failed-precondition", `${gym.get("nome")} já tem disputa de liderança aberta.`);
            if (historico.docs.some((h) => h.get("fim") == null && h.get("endedAt") == null && h.get("lider_uid") !== troca.promovido.uid))
                throw new https_1.HttpsError("failed-precondition", `Há uma liderança divergente em ${gym.get("nome")}.`);
            return { troca, gym, historico, desafios };
        }));
        if (atuais.size + mandatos.size + 18 + detalhes.reduce((s, d) => s + d.historico.size + d.desafios.size + 4, 0) > 450)
            throw new https_1.HttpsError("resource-exhausted", "Há registros demais para esta operação. Solicite uma revisão administrativa.");
        const agora = Date.now();
        const top4 = plano.novaElite.map((membro) => ({ ...membro, pontos: ranking.find((p) => p.uid === membro.uid)?.pontos || 0 }));
        const horas = Number(String(config.get("tempo_inscricoes") || 0).replace(",", "."));
        const nextStartAtMs = agora + (Number.isFinite(horas) ? Math.max(0, horas) * 3600000 : 0);
        const temporadaId = String(camp.get("temporada_id") || temporadas.docs[0]?.id || "");
        const temporadaNome = String(camp.get("temporada_nome") || temporadas.docs[0]?.get("nome") || "");
        const rebaixados = new Set(plano.trocas.map((t) => t.rebaixado?.uid).filter(Boolean));
        // Backup restrito ao administrador para auditoria e recuperação de cada transição.
        tx.create(adminSdk_1.db.doc(`elite4_auditoria/${campeonatoId}`), {
            campeonato_id: campeonatoId, admin_uid: adminUid, createdAt: agora, regra_versao: 2,
            elite_antes: atuais.docs.map((d) => ({ id: d.id, ...d.data() })),
            ginasios_antes: detalhes.map((d) => ({ id: d.gym.id, ...d.gym.data() })),
            liderancas_antes: detalhes.flatMap((d) => d.historico.docs.map((h) => ({ id: h.id, ...h.data() }))),
            desafios_antes: detalhes.flatMap((d) => d.desafios.docs.filter((h) => h.get("status") === "pendente").map((h) => ({ id: h.id, ...h.data() }))),
        });
        for (const d of atuais.docs)
            if (rebaixados.has(d.get("uid")))
                tx.delete(d.ref);
        for (const mandato of mandatos.docs)
            if (mandato.get("fim") == null && rebaixados.has(mandato.get("usuario_uid")))
                tx.update(mandato.ref, { fim: agora, motivo_fim: "troca_elite4_ginasio", campeonato_fim_id: campeonatoId });
        for (const t of plano.trocas) {
            const membro = plano.novaElite.find((e) => e.uid === t.promovido.uid);
            tx.set(adminSdk_1.db.doc(`elite4/${encodeURIComponent(liga)}_${t.pos}`), { ...membro, liga, campeonato_id: campeonatoId, updatedAt: agora });
            tx.create(adminSdk_1.db.doc(`elite4_mandatos/${campeonatoId}_${membro.uid}`), { usuario_uid: membro.uid, liga, pos: membro.pos, tipo: membro.tipo, ginasio_origem_id: membro.ginasio_origem_id, inicio: agora, fim: null, campeonato_id: campeonatoId });
        }
        const ginasiosLiberados = [];
        const ginasiosTransferidos = [];
        for (const { troca, gym, historico, desafios } of detalhes) {
            for (const h of historico.docs)
                if (h.get("fim") == null && h.get("endedAt") == null)
                    tx.update(h.ref, { fim: agora, endedAt: agora, motivo_fim: "promocao_elite4", campeonato_fim_id: campeonatoId });
            for (const d of desafios.docs)
                if (d.get("status") === "pendente" && d.get("lider_uid") === troca.promovido.uid)
                    tx.update(d.ref, { status: "cancelado", motivo_cancelamento: "lider_promovido_elite4", fechadoEm: agora });
            if (troca.rebaixado) {
                const novoLider = troca.rebaixado;
                tx.update(gym.ref, { lider_uid: novoLider.uid, tipo: novoLider.tipo, em_disputa: false, derrotas_seguidas: 0 });
                tx.create(adminSdk_1.db.doc(`ginasios_liderancas/elite4_${campeonatoId}_${gym.id}`), { ginasio_id: gym.id, lider_uid: novoLider.uid, tipo_no_periodo: novoLider.tipo, inicio: agora, fim: null, liga, origem: "rebaixamento_elite4", campeonato_id: campeonatoId, temporada_id: temporadaId, temporada_nome: temporadaNome });
                ginasiosTransferidos.push({ id: gym.id, nome: gym.get("nome") || gym.id, lider_uid: novoLider.uid, lider_nome: novoLider.nome, tipo: novoLider.tipo });
            }
            else {
                tx.update(gym.ref, { lider_uid: "", em_disputa: true, derrotas_seguidas: 0 });
                const disputaRef = adminSdk_1.db.doc(`disputas_ginasio/elite4_${campeonatoId}_${gym.id}`);
                tx.create(disputaRef, { ginasio_id: gym.id, status: "inscricoes", tipo_original: gym.get("tipo"), lider_anterior_uid: troca.promovido.uid, liga, temporada_id: temporadaId, temporada_nome: temporadaNome, origem: "promocao_elite4", campeonato_elite4_id: campeonatoId, createdAt: agora, nextStartAtMs });
                tx.create(adminSdk_1.db.doc(`jobs_disputas/elite4_${campeonatoId}_${gym.id}`), { acao: "iniciar_disputa", status: "pendente", ginasio_id: gym.id, disputa_id: disputaRef.id, origem: "promocao_elite4", runAtMs: nextStartAtMs, createdAt: agora });
                ginasiosLiberados.push({ id: gym.id, nome: gym.get("nome") || gym.id, disputa_id: disputaRef.id });
            }
        }
        const resultadoRef = resultadoAnterior?.ref || adminSdk_1.db.doc(`campeonatos_elite4_resultados/${campeonatoId}`);
        tx.set(resultadoRef, {
            campeonato_id: campeonatoId, liga, ranking: ranking.map((p, i) => ({ ...p, pos: i + 1 })), top4,
            top4_classificacao: ranking.filter((p) => p.optou_participar && p.tipo_participante === "lider").slice(0, 4),
            trocas: plano.trocas, appliedAt: agora, promocao_aplicada: true, admin_uid: adminUid, regra_versao: 2,
            elite4_anterior: atuais.docs.map((d) => ({ id: d.id, ...d.data() })), ginasios_liberados: ginasiosLiberados, ginasios_transferidos: ginasiosTransferidos,
        }, { merge: true });
        tx.update(campRef, { status: "fechado", ativo: false, closedAt: camp.get("closedAt") || agora, promocao_aplicada: true, promocao_aplicada_at: agora, promocao_admin_uid: adminUid, regra_versao: 2, resultado_id: resultadoRef.id, elite4_definida: top4, ginasios_liberados: ginasiosLiberados, ginasios_transferidos: ginasiosTransferidos, trocas: plano.trocas });
        return { ok: true, jaAplicada: false, top4, ginasiosLiberados, ginasiosTransferidos };
    });
}
exports.adminFinalizeElite4 = (0, https_1.onCall)({ region: "southamerica-east1" }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid)
        throw new https_1.HttpsError("unauthenticated", "Faça login.");
    if (!(await adminSdk_1.db.doc(`superusers/${uid}`).get()).exists)
        throw new https_1.HttpsError("permission-denied", "Apenas administradores podem encerrar a disputa.");
    const { campeonatoId, vencedores, selecionados } = request.data || {};
    if (selecionados !== undefined)
        throw new https_1.HttpsError("failed-precondition", "Atualize a página para carregar as novas regras de participação e troca de cargos.");
    if (!idValido(campeonatoId) || (vencedores !== undefined && (!Array.isArray(vencedores) || vencedores.some((v) => !idValido(v)))))
        throw new https_1.HttpsError("invalid-argument", "Informe a disputa e os líderes vencedores.");
    return aplicarPromocaoElite4(campeonatoId, uid, vencedores);
});
