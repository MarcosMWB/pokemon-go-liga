const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { HttpsError } = require('firebase-functions/v2/https');

// Exercita as regras da promoção com leituras antes das escritas e commit indivisível.
function ambiente(status = 'aberto') {
  const dados = new Map();
  const inserir = (caminho, valor) => dados.set(caminho, structuredClone(valor));
  class Referencia {
    constructor(caminho) { this.path = caminho; this.id = caminho.split('/').at(-1); }
    collection(nome) { return new Consulta(`${this.path}/${nome}`); }
    async get() { return snapshot(this); }
  }
  class Consulta {
    constructor(caminho, filtros = []) { this.path = caminho; this.filtros = filtros; }
    where(campo, operador, valor) { assert.equal(operador, '=='); return new Consulta(this.path, [...this.filtros, [campo, valor]]); }
  }
  function snapshot(ref) {
    return { ref, id: ref.id, exists: dados.has(ref.path), data: () => structuredClone(dados.get(ref.path)), get: (campo) => dados.get(ref.path)?.[campo] };
  }
  const db = {
    doc: (caminho) => new Referencia(caminho), collection: (caminho) => new Consulta(caminho),
    async runTransaction(fn) {
      const operacoes = [];
      const tx = {
        async get(ref) {
          assert.equal(operacoes.length, 0, 'A transação deve ler tudo antes de escrever.');
          if (ref instanceof Referencia) return snapshot(ref);
          const docs = [...dados.keys()].filter((key) => key.startsWith(`${ref.path}/`) && key.split('/').length === ref.path.split('/').length + 1)
            .filter((key) => ref.filtros.every(([campo, valor]) => dados.get(key)?.[campo] === valor)).map((key) => snapshot(new Referencia(key)));
          return { docs, size: docs.length, empty: docs.length === 0 };
        },
        set: (ref, valor, options) => operacoes.push(['set', ref, valor, options]),
        create: (ref, valor) => { assert.equal(dados.has(ref.path), false); operacoes.push(['set', ref, valor]); },
        update: (ref, valor) => { assert.equal(dados.has(ref.path), true); operacoes.push(['set', ref, valor, { merge: true }]); },
        delete: (ref) => operacoes.push(['delete', ref]),
      };
      const resultado = await fn(tx);
      for (const [tipo, ref, valor, options] of operacoes) {
        if (tipo === 'delete') dados.delete(ref.path);
        else inserir(ref.path, options?.merge ? { ...dados.get(ref.path), ...valor } : valor);
      }
      return resultado;
    },
  };
  const exports = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../lib/elite4.js'), 'utf8'), {
    exports, require: (nome) => nome === './adminSdk' ? { db } : { HttpsError, onCall: (_, fn) => fn },
    console, Date, Map, Set,
  });
  inserir('campeonatos_elite4/c1', { liga: 'Great', status, createdAt: 100 });
  inserir('temporadas/s1', { ativa: true, nome: 'Temporada 1' });
  inserir('variables/global', { tempo_inscricoes: 24 });
  const top4 = [];
  for (let i = 1; i <= 4; i++) {
    const pessoa = { uid: `u${i}`, usuario_uid: `u${i}`, nome: `Treinador ${i}`, pontos: 100 - i, tipo_participante: 'lider', ginasio_id: `g${i}` };
    top4.push(pessoa);
    inserir(`usuarios/u${i}`, { nome: pessoa.nome });
    inserir(`campeonatos_elite4/c1/participantes/u${i}`, pessoa);
    inserir(`ginasios/g${i}`, { nome: `Ginásio ${i}`, liga: 'Great', tipo: 'water', lider_uid: `u${i}`, derrotas_seguidas: 2 });
    inserir(`ginasios_liderancas/l${i}`, { ginasio_id: `g${i}`, lider_uid: `u${i}`, inicio: 1, fim: null });
    inserir(`elite4/antigo${i}`, { liga: 'Great', uid: `e${i}`, pos: i });
    inserir(`elite4_mandatos/m${i}`, { liga: 'Great', usuario_uid: `e${i}`, inicio: 1, fim: null });
  }
  inserir('desafios_ginasio/pendente', { ginasio_id: 'g1', lider_uid: 'u1', status: 'pendente' });
  inserir('desafios_ginasio/concluido', { ginasio_id: 'g1', lider_uid: 'u1', status: 'concluido' });
  if (status === 'fechado') inserir('campeonatos_elite4_resultados/legado', { campeonato_id: 'c1', liga: 'Great', ranking: top4, top4, appliedAt: 150 });
  return { dados, inserir, ...exports };
}

test('promove quatro, encerra mandatos, libera ginásios e agenda quatro disputas', async () => {
  const env = ambiente();
  const result = await env.aplicarPromocaoElite4('c1', 'admin');
  assert.equal(result.top4.length, 4);
  assert.equal(result.ginasiosLiberados.length, 4);
  for (let i = 1; i <= 4; i++) {
    assert.equal(env.dados.get(`elite4/Great_${i}`).uid, `u${i}`);
    assert.equal(env.dados.has(`elite4/antigo${i}`), false);
    assert.equal(env.dados.get(`ginasios/g${i}`).lider_uid, '');
    assert.equal(env.dados.get(`ginasios/g${i}`).em_disputa, true);
    assert.ok(env.dados.get(`ginasios_liderancas/l${i}`).fim > 0);
    assert.ok(env.dados.get(`elite4_mandatos/m${i}`).fim > 0);
    assert.equal(env.dados.get(`elite4_mandatos/c1_u${i}`).fim, null);
    assert.equal(env.dados.get(`disputas_ginasio/elite4_c1_g${i}`).temporada_id, 's1');
    assert.equal(env.dados.get(`jobs_disputas/elite4_c1_g${i}`).acao, 'iniciar_disputa');
    assert.ok(env.dados.get(`disputas_ginasio/elite4_c1_g${i}`).nextStartAtMs > Date.now());
  }
  assert.equal(env.dados.get('desafios_ginasio/pendente').status, 'cancelado');
  assert.equal(env.dados.get('desafios_ginasio/concluido').status, 'concluido');
  assert.equal(env.dados.get('campeonatos_elite4/c1').promocao_aplicada, true);
});

test('recupera uma disputa fechada usando o resultado arquivado', async () => {
  const env = ambiente('fechado');
  const result = await env.aplicarPromocaoElite4('c1', 'admin');
  assert.equal(result.jaAplicada, false);
  assert.equal(env.dados.get('campeonatos_elite4_resultados/legado').promocao_aplicada, true);
  assert.equal(env.dados.has('campeonatos_elite4_resultados/c1'), false);
});

test('uma nova tentativa não duplica mandatos, disputas ou jobs', async () => {
  const env = ambiente();
  await env.aplicarPromocaoElite4('c1', 'admin');
  const antes = JSON.stringify([...env.dados]);
  const result = await env.aplicarPromocaoElite4('c1', 'admin');
  assert.equal(result.jaAplicada, true);
  assert.equal(JSON.stringify([...env.dados]), antes);
});

test('reutiliza disputa ativa e não abre uma segunda para o mesmo ginásio', async () => {
  const env = ambiente();
  env.inserir('disputas_ginasio/existente', { ginasio_id: 'g1', status: 'batalhando' });
  await env.aplicarPromocaoElite4('c1', 'admin');
  assert.equal(env.dados.has('disputas_ginasio/elite4_c1_g1'), false);
  assert.equal(env.dados.has('jobs_disputas/elite4_c1_g1'), false);
});

test('permite manter um membro atual, preservando o início de seu mandato', async () => {
  const env = ambiente();
  env.inserir('campeonatos_elite4/c1/participantes/e1', { usuario_uid: 'e1', tipo_participante: 'elite4', pontos: 100 });
  await env.aplicarPromocaoElite4('c1', 'admin', ['e1', 'u2', 'u3', 'u4']);
  assert.equal(env.dados.get('elite4/Great_1').uid, 'e1');
  assert.equal(env.dados.get('elite4_mandatos/m1').inicio, 1);
  assert.equal(env.dados.get('elite4_mandatos/m1').fim, null);
  assert.equal(env.dados.has('elite4_mandatos/c1_e1'), false);
  assert.equal(env.dados.get('ginasios/g1').lider_uid, 'u1');
});

test('rejeita seleção duplicada e líder que já perdeu o cargo sem alterar dados', async () => {
  const env = ambiente();
  const antes = JSON.stringify([...env.dados]);
  await assert.rejects(env.aplicarPromocaoElite4('c1', 'admin', ['u1', 'u1', 'u3', 'u4']), { code: 'invalid-argument' });
  assert.equal(JSON.stringify([...env.dados]), antes);
  env.inserir('ginasios/g1', { liga: 'Great', lider_uid: 'outro' });
  const depois = JSON.stringify([...env.dados]);
  await assert.rejects(env.aplicarPromocaoElite4('c1', 'admin'), { code: 'failed-precondition' });
  assert.equal(JSON.stringify([...env.dados]), depois);
});

test('bloqueia recuperação antiga quando já existe uma disputa mais recente', async () => {
  const env = ambiente('fechado');
  env.inserir('campeonatos_elite4/c2', { liga: 'Great', status: 'aberto', createdAt: 200 });
  await assert.rejects(env.aplicarPromocaoElite4('c1', 'admin'), { code: 'failed-precondition' });
  assert.equal(env.dados.has('elite4/Great_1'), false);
});

test('callable exige autenticação e cadastro de superusuário', async () => {
  const env = ambiente();
  await assert.rejects(env.adminFinalizeElite4({ data: { campeonatoId: 'c1' } }), { code: 'unauthenticated' });
  await assert.rejects(env.adminFinalizeElite4({ auth: { uid: 'normal' }, data: { campeonatoId: 'c1' } }), { code: 'permission-denied' });
  env.inserir('superusers/admin', { uid: 'admin' });
  assert.equal((await env.adminFinalizeElite4({ auth: { uid: 'admin' }, data: { campeonatoId: 'c1' } })).ok, true);
});

test('não encerra com menos de quatro líderes nem com duas disputas ativas no mesmo ginásio', async () => {
  const env = ambiente();
  env.dados.delete('campeonatos_elite4/c1/participantes/u4');
  const antes = JSON.stringify([...env.dados]);
  await assert.rejects(env.aplicarPromocaoElite4('c1', 'admin'), { code: 'invalid-argument' });
  assert.equal(JSON.stringify([...env.dados]), antes);
  const duplicadas = ambiente();
  duplicadas.inserir('disputas_ginasio/a', { ginasio_id: 'g1', status: 'inscricoes' });
  duplicadas.inserir('disputas_ginasio/b', { ginasio_id: 'g1', status: 'batalhando' });
  const original = JSON.stringify([...duplicadas.dados]);
  await assert.rejects(duplicadas.aplicarPromocaoElite4('c1', 'admin'), { code: 'failed-precondition' });
  assert.equal(JSON.stringify([...duplicadas.dados]), original);
});

test('libera todos os ginásios de um promovido apenas na liga correspondente', async () => {
  const env = ambiente();
  env.inserir('ginasios/extra', { nome: 'Outro ginásio Great', liga: 'Great', lider_uid: 'u1' });
  env.inserir('ginasios/ultra', { liga: 'Ultra', lider_uid: 'u1' });
  const result = await env.aplicarPromocaoElite4('c1', 'admin');
  assert.equal(result.ginasiosLiberados.length, 5);
  assert.equal(env.dados.get('ginasios/extra').lider_uid, '');
  assert.equal(env.dados.get('ginasios/ultra').lider_uid, 'u1');
  assert.equal(env.dados.get('disputas_ginasio/elite4_c1_extra').status, 'inscricoes');
});
