const app = require('./app');
const config = require('./config');
const db = require('./db');

const server = app.listen(config.port, () => {
  console.log(`Eco API disponível em http://127.0.0.1:${config.port}/api`);
});

function shutdown(signal) {
  console.log(`\nEncerrando API (${signal})...`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
