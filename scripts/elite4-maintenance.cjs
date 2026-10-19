// Usa a sessão já autenticada da CLI Firebase; não grava nem imprime credenciais.
// Inspeção: node scripts/elite4-maintenance.cjs
// Recuperação: node scripts/elite4-maintenance.cjs --apply ID --expected UID1,UID2,UID3,UID4
// Verificação: node scripts/elite4-maintenance.cjs --verify ID
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
  const args = process.argv.slice(2);
  const id = args.includes('--apply') ? args[args.indexOf('--apply') + 1] : '';
  if (args.includes('--verify')) {
    const verifyId = args[args.indexOf('--verify') + 1];
    if (!verifyId || verifyId.includes('/')) throw new Error('Informe a disputa para verificar.');
    const camp = await db.doc(`campeonatos_elite4/${verifyId}`).get();
    if (camp.get('promocao_aplicada') !== true) throw new Error('A promoção não está marcada como aplicada.');
    const escolhidos = camp.get('elite4_definida');
    const elite = await db.collection('elite4').where('liga', '==', camp.get('liga')).get();
    if (elite.size !== 4 || escolhidos.some((p) => !elite.docs.some((e) => e.get('uid') === p.uid && e.get('pos') === p.pos))) throw new Error('A composição da Elite 4 não corresponde ao resultado aplicado.');
    const checks = [];
    for (const gym of camp.get('ginasios_liberados')) {
      const [g, dispute, job, history] = await Promise.all([
        db.doc(`ginasios/${gym.id}`).get(), db.doc(`disputas_ginasio/${gym.disputa_id}`).get(),
        db.doc(`jobs_disputas/elite4_${verifyId}_${gym.id}`).get(),
        db.collection('ginasios_liderancas').where('ginasio_id', '==', gym.id).get(),
      ]);
      if (g.get('lider_uid') || g.get('em_disputa') !== true || !['inscricoes', 'batalhando'].includes(dispute.get('status'))) throw new Error(`Ginásio ${gym.nome} não está disponível para sucessão.`);
      if (dispute.get('status') === 'inscricoes' && !job.exists && !dispute.get('nextStartAtMs')) throw new Error(`Ginásio ${gym.nome} está sem início agendado.`);
      if (history.docs.some((h) => h.get('fim') == null && h.get('endedAt') == null)) throw new Error(`Liderança antiga ainda ativa em ${gym.nome}.`);
      checks.push({ nome: gym.nome, lider_vago: true, disputa: dispute.get('status'), job: job.get('status') || 'agenda_existente' });
    }
    const mandates = await db.collection('elite4_mandatos').where('liga', '==', camp.get('liga')).get();
    if (escolhidos.some((p) => !mandates.docs.some((m) => m.get('usuario_uid') === p.uid && m.get('fim') == null))) throw new Error('Há um promovido sem mandato ativo no histórico.');
    console.log(JSON.stringify({ ok: true, campeonato_id: verifyId, elite4: escolhidos.map((p) => ({ nome: p.nome, pos: p.pos })), ginasios: checks }, null, 2));
  } else if (id) {
    const expected = args[args.indexOf('--expected') + 1]?.split(',') || [];
    if (!args.includes('--expected') || expected.length !== 4 || new Set(expected).size !== 4 || id.includes('/')) throw new Error('Informe o ID da disputa e os quatro UIDs esperados.');
    const archived = await db.collection('campeonatos_elite4_resultados').where('campeonato_id', '==', id).get();
    const result = archived.docs.find((item) => Array.isArray(item.get('top4')) && item.get('top4').map((p) => p.uid).join(',') === expected.join(','));
    if (!result) throw new Error('Os classificados arquivados não correspondem aos quatro UIDs esperados.');
    const camp = await db.doc(`campeonatos_elite4/${id}`).get();
    if (camp.get('status') !== 'fechado') throw new Error('Esta ferramenta recupera apenas disputas já encerradas.');
    const { aplicarPromocaoElite4 } = require('../functions/lib/elite4');
    console.log(JSON.stringify(await aplicarPromocaoElite4(id, 'firebase_cli_repair', expected), null, 2));
  } else {
    const [results, gyms, elite] = await Promise.all([
      db.collection('campeonatos_elite4_resultados').orderBy('appliedAt', 'desc').limit(5).get(),
      db.collection('ginasios').get(), db.collection('elite4').get(),
    ]);
    const report = [];
    for (const result of results.docs) {
      const data = result.data();
      const camp = await db.doc(`campeonatos_elite4/${data.campeonato_id}`).get();
      report.push({ resultado_id: result.id, campeonato_id: data.campeonato_id, liga: data.liga,
        status: camp.get('status'), appliedAt: data.appliedAt,
        promocao_aplicada: camp.get('promocao_aplicada') === true,
        top4: data.top4,
        ginasios: gyms.docs.filter((g) => (g.get('liga') || g.get('liga_nome')) === data.liga).map((g) => ({ id: g.id, nome: g.get('nome'), lider_uid: g.get('lider_uid'), em_disputa: g.get('em_disputa') })),
        elite_atual: elite.docs.filter((e) => e.get('liga') === data.liga).map((e) => ({ id: e.id, uid: e.get('uid'), pos: e.get('pos') })),
      });
    }
    console.log(JSON.stringify({ projectId, resultados: report }, null, 2));
  }
  await admin.app().delete();
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
