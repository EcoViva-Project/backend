/** Erro de regra de negócio: vira a resposta `{ "error": mensagem }` com o status indicado. */
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Interrompe a requisição com o status e a mensagem informados. */
function fail(status, message) {
  throw new ApiError(status, message);
}

/** Corpo da requisição como objeto simples (vazio quando não veio JSON de objeto). */
function bodyOf(req) {
  const { body } = req;
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
}

module.exports = { ApiError, fail, bodyOf };
