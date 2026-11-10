// Validação dos dados de conta (cadastro, perfil e senha), num lugar só.
//
// Mesmas regras e mensagens de `local_api.dart` (`_register`, `_addressFrom`,
// `_updateProfile`), mais o tamanho máximo da senha.

const { fail } = require('./errors');
const { clean } = require('./util');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 200;

/** Senha recebida (só aceita texto; qualquer outro tipo vira vazio). */
function passwordOf(value) {
  return typeof value === 'string' ? value : '';
}

function validateName(name) {
  if (name.length < 2 || name.length > 80) {
    fail(400, 'Informe um nome com 2 a 80 caracteres.');
  }
  return name;
}

function validateEmail(email) {
  if (email.length > 120 || !EMAIL_PATTERN.test(email)) {
    fail(400, 'Informe um e-mail válido.');
  }
  return email;
}

function validatePassword(password) {
  if (password.length < PASSWORD_MIN) {
    fail(400, `A senha deve ter pelo menos ${PASSWORD_MIN} caracteres.`);
  }
  if (password.length > PASSWORD_MAX) {
    fail(400, `A senha deve ter no máximo ${PASSWORD_MAX} caracteres.`);
  }
  return password;
}

function validateNeighborhood(value) {
  const neighborhood = clean(value);
  if (!neighborhood || neighborhood.length > 80) {
    fail(400, 'Informe um bairro com até 80 caracteres.');
  }
  return neighborhood;
}

/** Meta inteira de 1 a 100 (mensal ou semanal). */
function validateGoal(value) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100) {
    fail(400, 'As metas devem ser números inteiros entre 1 e 100.');
  }
  return value;
}

/** Lê e valida os campos de endereço enviados no cadastro ou no perfil. */
function addressFrom(data) {
  function field(key, max, label) {
    const value = clean(data[key]);
    if (!value) return null;
    if (value.length > max) fail(400, `${label} deve ter no máximo ${max} caracteres.`);
    return value;
  }

  const cep = clean(data.cep).replace(/[^0-9]/g, '');
  if (cep && cep.length !== 8) fail(400, 'Informe um CEP com 8 dígitos.');
  const state = field('state', 2, 'O estado');
  return {
    cep: cep ? `${cep.slice(0, 5)}-${cep.slice(5)}` : null,
    street: field('street', 120, 'A rua'),
    number: field('number', 12, 'O número'),
    complement: field('complement', 60, 'O complemento'),
    neighborhood: field('neighborhood', 80, 'O bairro') ?? '',
    city: field('city', 80, 'A cidade'),
    state: state ? state.toUpperCase() : null,
  };
}

module.exports = {
  EMAIL_PATTERN,
  PASSWORD_MIN,
  PASSWORD_MAX,
  passwordOf,
  validateName,
  validateEmail,
  validatePassword,
  validateNeighborhood,
  validateGoal,
  addressFrom,
};
