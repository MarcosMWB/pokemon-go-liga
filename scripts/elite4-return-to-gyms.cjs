// Recupera os quatro ginásios de origem de uma promoção Elite 4 cancelada.
// Usa a sessão da Firebase CLI; não imprime nem grava credenciais.
const fs = require('node:fs');
const path = require('node:path');
const admin = require('../functions/node_modules/firebase-admin');

async function main() {
  const cliPath = path.join(process.env.APPDATA, 'npm/node_modules/firebase-tools/lib');
  const firebaseAuth = require(path.join(cliPath, 'auth.js'));
  const firebaseApi = require(path.join(cliPath, 'api.js'));
  const account = firebaseAuth.getProjectDefaultAccount(path.resolve(__dirname, '..'));
  if (!account) throw new Error('Faça login na CLI Firebase antes de continuar.');
  const projectId = JSON.parse(fs.readFileSync(path.join(__dirname, '../.firebaserc'), 'utf8')).projects.default;
  admin.initializeApp({ projectId });
  const db = admin.firestore();
  db.settings({ preferRest: true, credentials: {
    type: 'authorized_user', client_id: firebaseApi.clientId(), client_secret: firebaseApi.clientSecret(),
    refresh_token: account.tokens.refresh_token,
  } });

  const campeonatoId = process.argv[2];
  if (!campeonatoId || campeonatoId.includes('/')) throw new Error('Informe o ID do campeonato Elite 4.');
  const campRef = db.doc(`campeonatos_elite4/${campeonatoId}`);
  const auditRef = db.doc(`elite4_auditoria/retorno_ginasios_${campeonatoId}`);
  const agora = Date.now();

  const result = await db.runTransaction(async (tx) => {
    const campSnap = await tx.get(campRef);
    if (!campSnap.exists) throw new Error('Campeonato não encontrado.');
    const camp = campSnap.data();
    if (camp.promocao_cancelada === true) return { ok: true, jaAplicado: true, ginasios: camp.ginasios_retomados || [] };
    if (camp.promocao_aplicada !== true || camp.status !== 'fechado') throw new Error('O campeonato não tem uma promoção encerrada para reverter.');

    const top4 = camp.elite4_definida || [];
    const fontes = top4.map((m) => ({ ...m, ginasio_id: m.ginasio_id || m.ginasio_origem_id }));
    if (fontes.length !== 4 || fontes.some((m) => !m.uid || !m.ginasio_id || !m.ginasio_tipo) || new Set(fontes.map((m) => m.ginasio_id)).size !== 4) {
      throw new Error('Os quatro ginásios de origem não estão identificados corretamente.');
    }
    const elitesQ = db.collection('elite4').where('liga', '==', camp.liga);
    const mandatesQ = db.collection('elite4_mandatos').where('liga', '==', camp.liga);
    const resultsQ = db.collection('campeonatos_elite4_resultados').where('campeonato_id', '==', campeonatoId);
    const [eliteSnap, mandateSnap, resultSnap, auditSnap] = await Promise.all([
      tx.get(elitesQ), tx.get(mandatesQ), tx.get(resultsQ), tx.get(auditRef),
    ]);
    if (auditSnap.exists) throw new Error('Existe uma auditoria anterior; a operação precisa de revisão manual.');
    if (eliteSnap.size !== 4 || formsMismatch(eliteSnap, fontes)) throw new Error('A Elite 4 mudou desde essa promoção; nenhuma alteração foi feita.');

    const docs = await Promise.all(fontes.map(async (m) => {
      const disputeId = `elite4_${campeonatoId}_${m.ginasio_id}`;
      const gymRef = db.doc(`ginasios/${m.ginasio_id}`);
      const disputeRef = db.doc(`disputas_ginasio/${disputeId}`);
      const jobRef = db.doc(`jobs_disputas/elite4_${campeonatoId}_${m.ginasio_id}`);
      const historyQ = db.collection('ginasios_liderancas').where('ginasio_id', '==', m.ginasio_id);
      const participantQ = db.collection('disputas_ginasio_participantes').where('disputa_id', '==', disputeId);
      const battleQ = db.collection('disputas_ginasio_resultados').where('disputa_id', '==', disputeId);
      const [gym, dispute, job, history, participants, battles] = await Promise.all([
        tx.get(gymRef), tx.get(disputeRef), tx.get(jobRef), tx.get(historyQ), tx.get(participantQ), tx.get(battleQ),
      ]);
      return { m, gymRef, gym, disputeRef, dispute, jobRef, job, history, participants, battles };
    }));

    for (const d of docs) {
      if (!d.gym.exists || d.gym.get('lider_uid') || d.gym.get('em_disputa') !== true) throw new Error(`O estado de ${d.m.ginasio_nome || d.m.ginasio_id} mudou; nenhuma alteração foi feita.`);
      if (!d.dispute.exists || d.dispute.get('status') !== 'inscricoes' || d.dispute.get('origem') !== 'promocao_elite4' || d.dispute.get('campeonato_elite4_id') !== campeonatoId) throw new Error(`A disputa de ${d.m.ginasio_nome || d.m.ginasio_id} não é mais a disputa original aberta.`);
      if (d.battles.size) throw new Error(`Já há resultados na disputa de ${d.m.ginasio_nome || d.m.ginasio_id}; nenhuma alteração foi feita.`);
      if (d.history.docs.some((h) => h.get('fim') == null && h.get('endedAt') == null)) throw new Error(`Há outra liderança ativa em ${d.m.ginasio_nome || d.m.ginasio_id}.`);
    }

    tx.create(auditRef, {
      campeonato_id: campeonatoId, liga: camp.liga, acao: 'retorno_elite4_aos_ginasios',
      elite4_anterior: eliteSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      ginasios_anteriores: docs.map((d) => ({ id: d.gymRef.id, ...d.gym.data() })),
      disputas_anteriores: docs.map((d) => ({ id: d.disputeRef.id, ...d.dispute.data() })),
      participantes_cancelados: docs.reduce((n, d) => n + d.participants.size, 0), criadoEm: agora,
    });

    const retomados = [];
    for (const d of docs) {
      const m = d.m;
      tx.update(d.gymRef, { lider_uid: m.uid, tipo: m.ginasio_tipo, em_disputa: false, derrotas_seguidas: 0 });
      tx.create(db.collection('ginasios_liderancas').doc(), {
        ginasio_id: m.ginasio_id, lider_uid: m.uid, tipo_no_periodo: m.ginasio_tipo,
        inicio: agora, fim: null, liga: camp.liga, temporada_id: camp.temporada_id || '',
        temporada_nome: camp.temporada_nome || '', origem: 'retorno_elite4_cancelada', campeonato_elite4_id: campeonatoId,
      });
      tx.update(d.disputeRef, {
        status: 'cancelado', finalizacao_aplicada: true, motivo_cancelamento: 'retorno_elite4_aos_ginasios',
        encerradaEm: agora, nextStartAtMs: admin.firestore.FieldValue.delete(),
      });
      if (d.job.exists) tx.update(d.jobRef, { status: 'cancelado', motivo_cancelamento: 'retorno_elite4_aos_ginasios', finalizadoEm: agora });
      for (const participant of d.participants.docs) tx.update(participant.ref, { removido: true, removido_motivo: 'elite4_cancelada_retorno_liderancas', removidoEm: agora });
      retomados.push({ id: m.ginasio_id, nome: m.ginasio_nome || d.gym.get('nome') || m.ginasio_id, uid: m.uid, tipo: m.ginasio_tipo });
    }
    for (const elite of eliteSnap.docs) tx.delete(elite.ref);
    for (const mandate of mandateSnap.docs) {
      if (mandate.get('fim') == null && fontes.some((m) => m.uid === mandate.get('usuario_uid'))) tx.update(mandate.ref, { fim: agora, motivo_fim: 'promocao_elite4_cancelada_retorno_ginasios', campeonato_fim_id: campeonatoId });
    }
    tx.update(campRef, { promocao_cancelada: true, promocao_cancelada_at: agora, promocao_cancelada_por: 'solicitacao_administrativa', ginasios_retomados: retomados });
    for (const archived of resultSnap.docs) tx.update(archived.ref, { promocao_cancelada: true, ginasios_retomados: retomados });
    return { ok: true, jaAplicado: false, ginasios: retomados, canceladas: docs.length };
  });

  const [eliteFinal, verificacoes] = await Promise.all([
    db.collection('elite4').where('liga', '==', 'Great').get(),
    Promise.all(result.ginasios.map(async (g) => {
      const disputeId = `elite4_${campeonatoId}_${g.id}`;
      const [gym, dispute, job] = await Promise.all([
        db.doc(`ginasios/${g.id}`).get(),
        db.doc(`disputas_ginasio/${disputeId}`).get(),
        db.doc(`jobs_disputas/${disputeId}`).get(),
      ]);
      if (gym.get('lider_uid') !== g.uid || gym.get('em_disputa') === true || dispute.get('status') !== 'cancelado' || job.get('status') !== 'cancelado') {
        throw new Error(`A conferência final falhou em ${g.nome}.`);
      }
      return { nome: g.nome, lider_restaurado: true, disputa: dispute.get('status'), agendamento: job.get('status') };
    })),
  ]);
  if (eliteFinal.size !== 0) throw new Error('Ainda há membros da Elite 4 Great depois da reversão.');
  console.log(JSON.stringify({ ...result, verificacao: { elite4_remanescente: eliteFinal.size, ginasios: verificacoes } }, null, 2));
  await admin.app().delete();
}

function formsMismatch(eliteSnap, fontes) {
  return fontes.some((m) => !eliteSnap.docs.some((d) => d.get('uid') === m.uid && d.get('pos') === m.pos));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
