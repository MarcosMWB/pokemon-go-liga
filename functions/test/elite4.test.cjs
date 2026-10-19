const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { HttpsError } = require('firebase-functions/v2/https');
const regras = require('../lib/elite4Plan');

function ambiente() {
  const dados = new Map();
  const deletar = Symbol('delete');
  let contador = 0;
  const inserir = (key, valor) => dados.set(key, structuredClone(valor));
  class Referencia {
    constructor(caminho) { this.path = caminho; this.id = caminho.split('/').at(-1); }
    collection(nome) { return new Consulta(`${this.path}/${nome}`); }
    async get() { return snapshot(this); }
  }
  class Consulta {
    constructor(caminho, filtros = []) { this.path = caminho; this.filtros = filtros; }
    where(campo, operador, valor) { assert.equal(operador, '=='); return new Consulta(this.path, [...this.filtros, [campo, valor]]); }
    doc(id = `auto${++contador}`) { return new Referencia(`${this.path}/${id}`); }
  }
  function snapshot(ref) { return { ref, id: ref.id, exists: dados.has(ref.path), data: () => structuredClone(dados.get(ref.path)), get: (key) => dados.get(ref.path)?.[key] }; }
  const db = {
    doc: (key) => new Referencia(key), collection: (key) => new Consulta(key),
    async runTransaction(fn) {
      const writes = [];
      const tx = {
        async get(ref) {
          assert.equal(writes.length, 0, 'Todas as leituras precisam acontecer antes das escritas.');
          if (ref instanceof Referencia) return snapshot(ref);
          const docs = [...dados.keys()].filter((key) => key.startsWith(`${ref.path}/`) && key.split('/').length === ref.path.split('/').length + 1)
            .filter((key) => ref.filtros.every(([campo, valor]) => dados.get(key)?.[campo] === valor)).map((key) => snapshot(new Referencia(key)));
          return { docs, size: docs.length, empty: !docs.length };
        },
        set: (ref, valor, options) => writes.push(['set', ref, valor, options]),
        create: (ref, valor) => { assert.equal(dados.has(ref.path), false); writes.push(['set', ref, valor]); },
        update: (ref, valor) => { assert.equal(dados.has(ref.path), true); writes.push(['set', ref, valor, { merge: true }]); },
        delete: (ref) => writes.push(['delete', ref]),
      };
      const result = await fn(tx);
      for (const [action, ref, value, options] of writes) {
        if (action === 'delete') dados.delete(ref.path);
        else {
          const next = options?.merge ? { ...dados.get(ref.path), ...value } : { ...value };
          for (const key of Object.keys(next)) if (next[key] === deletar) delete next[key];
          inserir(ref.path, next);
        }
      }
      return result;
    },
  };
  function carregar(file) {
    const exports = {};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../lib', file), 'utf8'), {
      exports, require: (nome) => nome === './adminSdk' ? { db, FieldValue: { delete: () => deletar } } : nome === './elite4Plan' ? regras : { HttpsError, onCall: (_, fn) => fn },
      console, Date, Map, Set,
    });
    return exports;
  }
  inserir('campeonatos_elite4/c1', { liga: 'Great', status: 'aberto', createdAt: 100, regra_versao: 2 });
  inserir('temporadas/s1', { ativa: true, nome: 'Temporada 1' });
  inserir('variables/global', { tempo_inscricoes: 24 });
  const tipos = ['fire', 'grass', 'electric', 'ice'];
  for (let i = 1; i <= 4; i++) {
    inserir(`usuarios/u${i}`, { nome: `Líder ${i}` });
    inserir(`usuarios/e${i}`, { nome: `Elite ${i}` });
    inserir(`campeonatos_elite4/c1/participantes/u${i}`, { usuario_uid: `u${i}`, pontos: 100 - i, tipo_participante: 'lider', optou_participar: true, ginasio_id: `g${i}`, ginasio_nome: `Ginásio ${i}`, ginasio_tipo: 'water' });
    inserir(`campeonatos_elite4/c1/participantes/e${i}`, { usuario_uid: `e${i}`, pontos: i * 10, tipo_participante: 'elite4', optou_participar: true });
    inserir(`ginasios/g${i}`, { nome: `Ginásio ${i}`, liga: 'Great', tipo: 'water', lider_uid: `u${i}`, derrotas_seguidas: 2, em_disputa: false });
    inserir(`ginasios_liderancas/l${i}`, { ginasio_id: `g${i}`, lider_uid: `u${i}`, inicio: 1, fim: null });
    inserir(`elite4/Great_${i}`, { liga: 'Great', uid: `e${i}`, nome: `Elite ${i}`, tipo: tipos[i - 1], pos: i });
    inserir(`elite4_mandatos/m${i}`, { liga: 'Great', usuario_uid: `e${i}`, tipo: tipos[i - 1], inicio: 1, fim: null });
  }
  inserir('desafios_ginasio/pendente', { ginasio_id: 'g1', lider_uid: 'u1', status: 'pendente' });
  return { dados, inserir, ...carregar('elite4.js'), ...carregar('elite4Repair.js') };
}

function semElite(env) {
  for (const key of [...env.dados.keys()]) if (key.startsWith('elite4/') || key.startsWith('elite4_mandatos/')) env.dados.delete(key);
}

test('um vencedor troca com o Elite de menor pontuação e os dois preservam seus tipos', async () => {
  const env = ambiente();
  await env.aplicarPromocaoElite4('c1', 'admin', ['u1']);
  assert.equal(env.dados.get('elite4/Great_1').uid, 'u1');
  assert.equal(env.dados.get('elite4/Great_1').tipo, 'water');
  assert.equal(env.dados.get('ginasios/g1').lider_uid, 'e1');
  assert.equal(env.dados.get('ginasios/g1').tipo, 'fire');
  assert.equal(env.dados.get('ginasios/g1').em_disputa, false);
  assert.equal(env.dados.get('ginasios_liderancas/elite4_c1_g1').tipo_no_periodo, 'fire');
  assert.ok(env.dados.get('elite4_mandatos/m1').fim > 0);
  assert.equal(env.dados.get('elite4_mandatos/m2').fim, null);
  assert.equal([...env.dados.keys()].some((k) => k.startsWith('disputas_ginasio/')), false);
  assert.equal(env.dados.get('desafios_ginasio/pendente').status, 'cancelado');
  assert.equal(env.dados.get('campeonatos_elite4_resultados/c1').top4.find((p) => p.uid === 'u1').pontos, 99);
  assert.equal(env.dados.get('campeonatos_elite4_resultados/c1').top4.find((p) => p.uid === 'e2').pontos, 20);
});

test('todos optando por não participar mantém os quatro cargos e todos os ginásios intactos', async () => {
  const env = ambiente();
  for (let i = 1; i <= 4; i++) env.dados.get(`campeonatos_elite4/c1/participantes/u${i}`).optou_participar = false;
  const antes = [...env.dados].filter(([key]) => key.startsWith('elite4/') || key.startsWith('ginasios/') || key.startsWith('elite4_mandatos/'));
  const result = await env.aplicarPromocaoElite4('c1', 'admin');
  assert.equal(result.top4.length, 4);
  assert.equal(result.ginasiosLiberados.length, 0);
  assert.equal(result.ginasiosTransferidos.length, 0);
  assert.deepEqual([...env.dados].filter(([key]) => key.startsWith('elite4/') || key.startsWith('ginasios/') || key.startsWith('elite4_mandatos/')), antes);
});

test('ausência de consentimento é tratada como não participar, mesmo com pontuação alta', async () => {
  const env = ambiente();
  for (let i = 1; i <= 4; i++) delete env.dados.get(`campeonatos_elite4/c1/participantes/u${i}`).optou_participar;
  await env.aplicarPromocaoElite4('c1', 'admin');
  assert.equal(env.dados.get('elite4/Great_1').uid, 'e1');
  assert.equal(env.dados.get('ginasios/g1').lider_uid, 'u1');
});

test('outros ginásios do promovido na mesma liga e em outra liga permanecem intactos', async () => {
  const env = ambiente();
  env.inserir('ginasios/extra', { liga: 'Great', lider_uid: 'u1', tipo: 'bug', derrotas_seguidas: 2 });
  env.inserir('ginasios/ultra', { liga: 'Ultra', lider_uid: 'u1', tipo: 'dark' });
  await env.aplicarPromocaoElite4('c1', 'admin', ['u1']);
  assert.deepEqual(env.dados.get('ginasios/extra'), { liga: 'Great', lider_uid: 'u1', tipo: 'bug', derrotas_seguidas: 2 });
  assert.equal(env.dados.get('ginasios/ultra').lider_uid, 'u1');
});

test('primeira formação abre disputas só nos quatro ginásios inscritos', async () => {
  const env = ambiente(); semElite(env);
  env.inserir('ginasios/extra', { liga: 'Great', lider_uid: 'u1', tipo: 'bug' });
  const result = await env.aplicarPromocaoElite4('c1', 'admin');
  assert.equal(result.ginasiosLiberados.length, 4);
  for (let i = 1; i <= 4; i++) {
    assert.equal(env.dados.get(`ginasios/g${i}`).lider_uid, '');
    assert.equal(env.dados.get(`disputas_ginasio/elite4_c1_g${i}`).status, 'inscricoes');
    assert.equal(env.dados.get(`jobs_disputas/elite4_c1_g${i}`).acao, 'iniciar_disputa');
    assert.equal(env.dados.get(`elite4/Great_${i}`).tipo, 'water');
  }
  assert.equal(env.dados.get('ginasios/extra').lider_uid, 'u1');
});

test('múltiplos vencedores recebem os menores pontuadores atuais sem repetição', async () => {
  const env = ambiente();
  await env.aplicarPromocaoElite4('c1', 'admin', ['u2', 'u1']);
  assert.equal(env.dados.get('ginasios/g1').lider_uid, 'e1');
  assert.equal(env.dados.get('ginasios/g2').lider_uid, 'e2');
  assert.equal(env.dados.get('ginasios/g2').tipo, 'grass');
  assert.equal(env.dados.get('elite4/Great_3').uid, 'e3');
});

test('a sugestão por pontos preserva o cargo do incumbente em um empate', async () => {
  const env = ambiente();
  for (let i = 1; i <= 4; i++) env.dados.get(`campeonatos_elite4/c1/participantes/u${i}`).pontos = 10;
  const result = await env.aplicarPromocaoElite4('c1', 'admin');
  assert.equal(result.ginasiosTransferidos.length, 0);
  assert.equal(env.dados.get('elite4/Great_1').uid, 'e1');
});

test('recusa líder sem consentimento, seleção duplicada ou mudança do ginásio inscrito', async () => {
  const env = ambiente();
  env.dados.get('campeonatos_elite4/c1/participantes/u1').optou_participar = false;
  const antes = JSON.stringify([...env.dados]);
  await assert.rejects(env.aplicarPromocaoElite4('c1', 'admin', ['u1']), { code: 'failed-precondition' });
  await assert.rejects(env.aplicarPromocaoElite4('c1', 'admin', ['u2', 'u2']), { code: 'failed-precondition' });
  assert.equal(JSON.stringify([...env.dados]), antes);
  env.dados.get('ginasios/g2').lider_uid = 'outro';
  await assert.rejects(env.aplicarPromocaoElite4('c1', 'admin', ['u2']), { code: 'failed-precondition' });
});

test('repetir encerramento não duplica trocas, mandatos, históricos ou auditoria', async () => {
  const env = ambiente();
  await env.aplicarPromocaoElite4('c1', 'admin', ['u1']);
  const antes = JSON.stringify([...env.dados]);
  assert.equal((await env.aplicarPromocaoElite4('c1', 'admin', ['u1'])).jaAplicada, true);
  assert.equal(JSON.stringify([...env.dados]), antes);
});

test('só as batalhas do ginásio escolhido por um líder com consentimento somam pontos', () => {
  const p = { tipo_participante: 'lider', optou_participar: true, ginasio_id: 'g1' };
  assert.equal(regras.podePontuarGinasio(p, 'g1'), true);
  assert.equal(regras.podePontuarGinasio(p, 'extra'), false);
  assert.equal(regras.podePontuarGinasio({ ...p, optou_participar: false }, 'g1'), false);
  assert.equal(regras.podePontuarGinasio({ ...p, tipo_participante: 'elite4' }, 'g1'), false);
  assert.equal(regras.podePontuarGinasio(undefined, 'g1'), false);
});

test('participação só pode ser escolhida pelo próprio líder em ginásio estável da liga', async () => {
  const env = ambiente();
  env.dados.delete('campeonatos_elite4/c1/participantes/u1');
  await env.setElite4Participation({ auth: { uid: 'u1' }, data: { campeonatoId: 'c1', participar: false } });
  assert.equal(env.dados.get('campeonatos_elite4/c1/participantes/u1').optou_participar, false);
  await env.setElite4Participation({ auth: { uid: 'u1' }, data: { campeonatoId: 'c1', participar: true, ginasioId: 'g1' } });
  assert.equal(env.dados.get('campeonatos_elite4/c1/participantes/u1').ginasio_tipo, 'water');
  await assert.rejects(env.setElite4Participation({ auth: { uid: 'u1' }, data: { campeonatoId: 'c1', participar: true, ginasioId: 'g2' } }), { code: 'failed-precondition' });
  env.dados.get('campeonatos_elite4/c1').status = 'fechado';
  await assert.rejects(env.setElite4Participation({ auth: { uid: 'u1' }, data: { campeonatoId: 'c1', participar: false } }), { code: 'failed-precondition' });
});

test('trocar ginásio inscrito zera todos os componentes da pontuação e atualiza o tipo', async () => {
  const env = ambiente();
  env.inserir('ginasios/extra', { nome: 'Extra', liga: 'Great', lider_uid: 'u1', tipo: 'bug', em_disputa: false });
  await env.setElite4Participation({ auth: { uid: 'u1' }, data: { campeonatoId: 'c1', participar: true, ginasioId: 'extra' } });
  const p = env.dados.get('campeonatos_elite4/c1/participantes/u1');
  assert.equal(p.pontos, 0); assert.equal(p.pontos_admin, 0); assert.equal(p.ginasio_tipo, 'bug');
});

test('callable exige admin, autenticação e versão atual do formulário', async () => {
  const env = ambiente();
  await assert.rejects(env.adminFinalizeElite4({ data: { campeonatoId: 'c1' } }), { code: 'unauthenticated' });
  await assert.rejects(env.adminFinalizeElite4({ auth: { uid: 'u1' }, data: { campeonatoId: 'c1' } }), { code: 'permission-denied' });
  env.inserir('superusers/admin', { uid: 'admin' });
  await assert.rejects(env.adminFinalizeElite4({ auth: { uid: 'admin' }, data: { campeonatoId: 'c1', selecionados: ['u1'] } }), { code: 'failed-precondition' });
  assert.equal((await env.adminFinalizeElite4({ auth: { uid: 'admin' }, data: { campeonatoId: 'c1', vencedores: [] } })).ok, true);
});

test('uma disputa mais recente bloqueia a recuperação de um resultado antigo', async () => {
  const env = ambiente();
  env.inserir('campeonatos_elite4/c2', { liga: 'Great', status: 'aberto', createdAt: 200 });
  await assert.rejects(env.aplicarPromocaoElite4('c1', 'admin'), { code: 'failed-precondition' });
});

test('correção legada restaura apenas o extra, cancela sua disputa e preenche tipos da Elite', async () => {
  const env = ambiente(); semElite(env);
  const top4 = [];
  const liberados = [];
  for (let i = 1; i <= 4; i++) {
    top4.push({ uid: `u${i}`, nome: `Líder ${i}`, ginasio_id: `g${i}`, pos: i });
    env.inserir(`elite4/Great_${i}`, { uid: `u${i}`, nome: `Líder ${i}`, liga: 'Great', pos: i });
    env.inserir(`elite4_mandatos/c1_u${i}`, { usuario_uid: `u${i}`, liga: 'Great', fim: null });
    env.dados.get(`ginasios/g${i}`).lider_uid = '';
    liberados.push({ id: `g${i}`, nome: `Ginásio ${i}`, disputa_id: `d${i}` });
  }
  liberados.push({ id: 'extra', nome: 'Extra', disputa_id: 'dextra' });
  env.inserir('ginasios/extra', { nome: 'Extra', liga: 'Great', tipo: 'bug', lider_uid: '', em_disputa: true });
  env.inserir('disputas_ginasio/dextra', { ginasio_id: 'extra', origem: 'promocao_elite4', status: 'inscricoes', lider_anterior_uid: 'u1' });
  env.inserir('jobs_disputas/extra', { disputa_id: 'dextra', status: 'pendente' });
  env.inserir('ginasios_liderancas/extra', { ginasio_id: 'extra', lider_uid: 'u1', fim: 123, endedAt: 123, motivo_fim: 'promocao_elite4', campeonato_id: 'c1' });
  env.inserir('campeonatos_elite4/c1', { liga: 'Great', status: 'fechado', promocao_aplicada: true, elite4_definida: top4, ginasios_liberados: liberados });
  const result = await env.corrigirGinasiosDaPromocao('c1');
  assert.equal(result.restaurados.length, 1);
  assert.equal(env.dados.get('ginasios/extra').lider_uid, 'u1');
  assert.equal(env.dados.get('ginasios_liderancas/extra').fim, null);
  assert.equal(env.dados.get('disputas_ginasio/dextra').status, 'cancelado');
  assert.equal(env.dados.get('jobs_disputas/extra').status, 'cancelado');
  assert.equal(env.dados.get('elite4/Great_1').tipo, 'water');
  assert.equal(env.dados.get('ginasios/g1').lider_uid, '');
  assert.equal((await env.corrigirGinasiosDaPromocao('c1')).jaCorrigida, true);
});
