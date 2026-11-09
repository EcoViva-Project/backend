const test = require('node:test');
const assert = require('node:assert/strict');

const { startServer, stopServer } = require('./helpers');

test('CORS: sem CORS_ORIGIN libera qualquer origem', async (t) => {
  const baseUrl = await startServer();
  t.after(stopServer);

  const response = await fetch(`${baseUrl}/health`, {
    headers: { Origin: 'http://localhost:8080' },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
});
