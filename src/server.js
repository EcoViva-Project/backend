const net = require('node:net');
const app = require('./app');
const config = require('./config');
const db = require('./db');

/** Endereços que só este computador alcança. */
function isLoopback(address) {
  return address === '::1' || address === 'localhost' || address.startsWith('127.');
}

/** URL da API no endereço em que o servidor realmente escuta. */
function describeAddress({ address, port }) {
  const host = net.isIPv6(address) ? `[${address}]` : address;
  return { url: `http://${host}:${port}/api`, exposed: !isLoopback(address) };
}

/**
 * Sobe a API em `HOST` (padrão 127.0.0.1, só este computador) e `PORT`.
 * Com `HOST=0.0.0.0` (ou `::`) a API fica aberta para a rede.
 */
function start({ port = config.port, host = config.host, log = console } = {}) {
  const server = app.listen(port, host, () => {
    const { url, exposed } = describeAddress(server.address());
    log.log(`Eco API disponível em ${url}`);
    if (exposed) {
      log.warn(
        `Atenção: HOST=${host} deixa a API aberta para a rede (outros aparelhos podem chamá-la). ` +
          'Para usar só neste computador, deixe HOST=127.0.0.1.',
      );
    }
  });
  return server;
}

if (require.main === module) {
  const server = start();

  function shutdown(signal) {
    console.log(`\nEncerrando API (${signal})...`);
    server.close(() => {
      db.close();
      process.exit(0);
    });
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

module.exports = { start, describeAddress };
