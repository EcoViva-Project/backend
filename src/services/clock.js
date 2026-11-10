// Relógio da aplicação.
//
// Todas as regras que dependem de "agora" (teto semanal, limites por dia,
// prazos de desafio, validade de cupom) leem a hora daqui, para que os testes
// e a carga de demonstração possam fixar o instante.

let fixed = null;

/** Instante atual (ou o instante fixado por `setNow`). */
function now() {
  return fixed === null ? new Date() : new Date(fixed);
}

/**
 * Fixa o relógio em um instante (Date, texto ISO ou milissegundos).
 * `setNow(null)` volta ao relógio do sistema.
 */
function setNow(value) {
  if (value === null || value === undefined) {
    fixed = null;
    return;
  }
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (Number.isNaN(time)) {
    throw new Error(`Instante inválido para o relógio: ${value}`);
  }
  fixed = time;
}

/** Instante fixado no momento (milissegundos), ou `null` se o relógio é o do sistema. */
function fixedAt() {
  return fixed;
}

module.exports = { now, setNow, fixedAt };
