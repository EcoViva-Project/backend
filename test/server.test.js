// Inicialização do servidor: escuta só em 127.0.0.1 por padrão e o log mostra
// o endereço real. Usa porta aleatória (0), nunca a porta do `.env`.

const test = require('node:test');
const assert = require('node:assert/strict');

require('./helpers');
const config = require('../src/config');
const { start, describeAddress } = require('../src/server');

function listening(server) {
  return new Promise((resolve, reject) => {
    if (server.listening) return resolve();
    server.once('listening', resolve);
    server.once('error', reject);
  });
}

function closed(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('servidor: sem HOST escuta só em 127.0.0.1 e o log mostra esse endereço', async () => {
  assert.equal(config.host, '127.0.0.1');
  const lines = [];
  const server = start({ port: 0, log: { log: (line) => lines.push(String(line)), warn: (line) => lines.push(String(line)) } });
  await listening(server);
  try {
    const { address, port } = server.address();
    assert.equal(address, '127.0.0.1');
    assert.ok(lines.some((line) => line.includes(`http://127.0.0.1:${port}/api`)), lines.join('\n'));
    assert.ok(!lines.some((line) => /rede/i.test(line)), 'sem aviso de rede no endereço local');
  } finally {
    await closed(server);
  }
});

test('servidor: o texto do log usa o endereço real, com aviso quando aberto à rede', () => {
  assert.deepEqual(describeAddress({ address: '127.0.0.1', port: 3100 }), {
    url: 'http://127.0.0.1:3100/api',
    exposed: false,
  });
  assert.deepEqual(describeAddress({ address: '::1', port: 3100 }), {
    url: 'http://[::1]:3100/api',
    exposed: false,
  });
  assert.deepEqual(describeAddress({ address: '0.0.0.0', port: 3100 }), {
    url: 'http://0.0.0.0:3100/api',
    exposed: true,
  });
  assert.deepEqual(describeAddress({ address: '::', port: 3100 }), {
    url: 'http://[::]:3100/api',
    exposed: true,
  });
  assert.deepEqual(describeAddress({ address: '192.168.0.10', port: 3100 }), {
    url: 'http://192.168.0.10:3100/api',
    exposed: true,
  });
});
