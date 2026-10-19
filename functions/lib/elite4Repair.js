"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.corrigirGinasiosDaPromocao = corrigirGinasiosDaPromocao;
const https_1 = require("firebase-functions/v2/https");
const adminSdk_1 = require("./adminSdk");
/** Corrige somente a promoção antiga que liberou também os ginásios não inscritos. */
async function corrigirGinasiosDaPromocao(campeonatoId) {
    return adminSdk_1.db.runTransaction(async (tx) => {
        const campRef = adminSdk_1.db.doc(`campeonatos_elite4/${campeonatoId}`);
        const camp = await tx.get(campRef);
        if (!camp.exists || camp.get("promocao_aplicada") !== true)
            throw new https_1.HttpsError("failed-precondition", "A promoção original não foi aplicada.");
        if (camp.get("correcao_ginasio_origem_v2") === true)
            return { ok: true, jaCorrigida: true };
        const top4 = camp.get("elite4_definida") || [];
        const liberados = camp.get("ginasios_liberados") || [];
        const origens = new Set(top4.map((p) => p.ginasio_id));
        if (top4.length !== 4 || origens.size !== 4)
            throw new https_1.HttpsError("failed-precondition", "Os quatro ginásios de origem não estão registrados.");
        const [elites, resultados, mandatos] = await Promise.all([
            tx.get(adminSdk_1.db.collection("elite4").where("liga", "==", camp.get("liga"))),
            tx.get(adminSdk_1.db.collection("campeonatos_elite4_resultados").where("campeonato_id", "==", campeonatoId)),
            tx.get(adminSdk_1.db.collection("elite4_mandatos").where("liga", "==", camp.get("liga"))),
        ]);
        if (elites.size !== 4 || top4.some((p) => !elites.docs.some((e) => e.get("uid") === p.uid)))
            throw new https_1.HttpsError("failed-precondition", "A Elite 4 mudou depois da promoção. É necessária uma revisão.");
        const fontes = await Promise.all(top4.map((p) => tx.get(adminSdk_1.db.doc(`ginasios/${p.ginasio_id}`))));
        const extras = await Promise.all(liberados.filter((g) => !origens.has(g.id)).map(async (gym) => {
            const [atual, disputa, participantes, batalhas, jobs, historico, desafios] = await Promise.all([
                tx.get(adminSdk_1.db.doc(`ginasios/${gym.id}`)), tx.get(adminSdk_1.db.doc(`disputas_ginasio/${gym.disputa_id}`)),
                tx.get(adminSdk_1.db.collection("disputas_ginasio_participantes").where("disputa_id", "==", gym.disputa_id)),
                tx.get(adminSdk_1.db.collection("disputas_ginasio_resultados").where("disputa_id", "==", gym.disputa_id)),
                tx.get(adminSdk_1.db.collection("jobs_disputas").where("disputa_id", "==", gym.disputa_id)),
                tx.get(adminSdk_1.db.collection("ginasios_liderancas").where("ginasio_id", "==", gym.id)),
                tx.get(adminSdk_1.db.collection("desafios_ginasio").where("ginasio_id", "==", gym.id)),
            ]);
            const lider = disputa.get("lider_anterior_uid");
            if (!top4.some((p) => p.uid === lider) || (atual.get("lider_uid") && atual.get("lider_uid") !== lider) || participantes.size || batalhas.size || disputa.get("origem") !== "promocao_elite4") {
                throw new https_1.HttpsError("failed-precondition", `O ginásio ${gym.nome} tem alterações posteriores; a correção automática foi interrompida.`);
            }
            return { gym, atual, disputa, jobs, historico, desafios, lider };
        }));
        for (const fonte of fontes)
            if (!fonte.exists || !fonte.get("tipo"))
                throw new https_1.HttpsError("failed-precondition", "Não foi possível recuperar o tipo do ginásio de origem.");
        const agora = Date.now();
        tx.create(adminSdk_1.db.doc(`elite4_auditoria/correcao_${campeonatoId}`), {
            campeonato_id: campeonatoId, acao: "restaurar_ginasios_nao_inscritos", createdAt: agora,
            elites_antes: elites.docs.map((e) => ({ id: e.id, ...e.data() })),
            ginasios_antes: extras.map((e) => ({ id: e.atual.id, ...e.atual.data() })),
            disputas_antes: extras.map((e) => ({ id: e.disputa.id, ...e.disputa.data() })),
            liderancas_antes: extras.flatMap((e) => e.historico.docs.map((h) => ({ id: h.id, ...h.data() }))),
        });
        for (const extra of extras) {
            tx.update(extra.atual.ref, { lider_uid: extra.lider, em_disputa: false });
            tx.update(extra.disputa.ref, { status: "cancelado", finalizacao_aplicada: true, motivo_cancelamento: "ginasio_nao_inscrito_elite4", encerradaEm: agora, nextStartAtMs: adminSdk_1.FieldValue.delete() });
            for (const job of extra.jobs.docs)
                if (["pendente", "executando"].includes(job.get("status")))
                    tx.update(job.ref, { status: "cancelado", motivo: "correcao_ginasio_nao_inscrito", cancelledAt: agora });
            for (const historico of extra.historico.docs) {
                if (historico.get("campeonato_id") === campeonatoId && historico.get("motivo_fim") === "promocao_elite4") {
                    tx.update(historico.ref, { fim: null, endedAt: null, motivo_fim: adminSdk_1.FieldValue.delete(), corrigidoEm: agora });
                }
            }
            for (const desafio of extra.desafios.docs) {
                if (desafio.get("status") === "cancelado" && desafio.get("motivo_cancelamento") === "lider_promovido_elite4" && desafio.get("fechadoEm") === camp.get("promocao_aplicada_at")) {
                    tx.update(desafio.ref, { status: "pendente", motivo_cancelamento: adminSdk_1.FieldValue.delete(), fechadoEm: adminSdk_1.FieldValue.delete() });
                }
            }
        }
        const corrigidos = top4.map((p, index) => {
            const fonte = fontes[index];
            const tipo = String(fonte.get("tipo"));
            const elite = elites.docs.find((e) => e.get("uid") === p.uid);
            tx.update(elite.ref, { tipo, ginasio_origem_id: fonte.id, ginasio_origem_nome: fonte.get("nome") || fonte.id });
            for (const mandato of mandatos.docs)
                if (mandato.get("usuario_uid") === p.uid && mandato.get("fim") == null) {
                    tx.update(mandato.ref, { tipo, ginasio_origem_id: fonte.id });
                }
            return { ...p, nome: String(p.nome || p.uid), tipo, ginasio_tipo: tipo };
        });
        const restaurados = extras.map((e) => ({ id: e.gym.id, nome: e.gym.nome, lider_uid: e.lider }));
        const campos = { elite4_definida: corrigidos, ginasios_liberados: liberados.filter((g) => origens.has(g.id)), ginasios_restaurados: restaurados, correcao_ginasio_origem_v2: true, corrigidoEm: agora };
        tx.update(campRef, campos);
        for (const resultado of resultados.docs)
            tx.update(resultado.ref, { top4: corrigidos, ginasios_liberados: campos.ginasios_liberados, ginasios_restaurados: restaurados, correcao_ginasio_origem_v2: true });
        return { ok: true, restaurados, elites: corrigidos.map((p) => ({ nome: p.nome, tipo: p.tipo })) };
    });
}
