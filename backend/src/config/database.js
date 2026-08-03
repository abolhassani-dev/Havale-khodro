const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');
const { encrypt, decrypt, blindIndex } = require('../utils/crypto');

// A single client for the process. Creating one per request exhausts the
// database's connection limit under load — the most common way an app like this
// falls over in production.
const prisma = new PrismaClient();

/**
 * Which columns are encrypted at rest, and which of them need to be searchable.
 *
 * `phone` identifies an account, so it also gets a blind index — a keyed HMAC
 * in a second column that queries can match on. `coordinatorPhone` is only ever
 * read, never searched, so it needs none.
 *
 * This lives at the client rather than in each service on purpose. A rule
 * enforced at twenty call sites is a rule that will be missed at the twenty
 * first; here, no query can write a plain number even by accident.
 */
const ENCRYPTED = {
  User: { fields: ['phone', 'coordinatorPhone'], indexed: { phone: 'phoneIndex' } },
  ContactReveal: { fields: ['phoneShown'], indexed: {} },
};

function encryptWrite(model, data) {
  const spec = ENCRYPTED[model];
  if (!spec || !data || typeof data !== 'object') return data;

  const out = { ...data };
  for (const field of spec.fields) {
    if (out[field] === undefined || out[field] === null) continue;
    const indexField = spec.indexed[field];
    // The index is computed from the plaintext before it is replaced, and only
    // when the value itself changes — so the two cannot drift apart.
    if (indexField) out[indexField] = blindIndex(out[field]);
    out[field] = encrypt(out[field]);
  }
  return out;
}

/**
 * Rewrites a `where` that filters on an encrypted column.
 *
 * `where: { phone }` cannot match — the stored value differs every time it is
 * written. It becomes `where: { phoneIndex }`, which does. Doing it here means
 * existing queries keep working unchanged rather than every caller having to
 * remember the substitution.
 */
function rewriteWhere(model, where) {
  const spec = ENCRYPTED[model];
  if (!spec || !where || typeof where !== 'object') return where;

  const out = { ...where };
  for (const [field, indexField] of Object.entries(spec.indexed)) {
    if (out[field] !== undefined) {
      const value = out[field];
      // Only exact matching is possible on an encrypted column. `contains` and
      // friends cannot work, and silently returning nothing would be worse
      // than saying so.
      if (value && typeof value === 'object') {
        if ('equals' in value) {
          out[indexField] = blindIndex(value.equals);
        } else {
          throw new Error(
            `Cannot filter ${model}.${field} with ${Object.keys(value).join(', ')} — ` +
              'the column is encrypted, so only exact matches are possible.'
          );
        }
      } else {
        out[indexField] = blindIndex(value);
      }
      delete out[field];
    }
  }

  for (const key of ['AND', 'OR', 'NOT']) {
    if (Array.isArray(out[key])) out[key] = out[key].map((clause) => rewriteWhere(model, clause));
  }
  return out;
}

function decryptRead(model, result) {
  const spec = ENCRYPTED[model];
  if (!spec || !result) return result;

  if (Array.isArray(result)) return result.map((row) => decryptRead(model, row));
  if (typeof result !== 'object') return result;

  const out = { ...result };
  for (const field of spec.fields) {
    if (typeof out[field] === 'string') out[field] = decrypt(out[field]);
  }
  return out;
}

/**
 * Decrypts users reached through `include`.
 *
 * A listing is loaded with `include: { owner: true }`, and the owner's phone is
 * the entire point of the masking rules. Without this it comes back as
 * ciphertext and a paying agent is shown gibberish.
 */
function decryptRelations(result) {
  if (!result) return result;
  if (Array.isArray(result)) return result.map(decryptRelations);
  if (typeof result !== 'object') return result;

  const out = { ...result };
  for (const relation of ['owner', 'user', 'viewer', 'parent', 'agent', 'staff']) {
    if (out[relation] && typeof out[relation] === 'object') {
      out[relation] = decryptRead('User', out[relation]);
    }
  }
  return out;
}

prisma.$use(async (params, next) => {
  const { model, action, args } = params;

  if (model && ENCRYPTED[model] && args) {
    if (args.data) {
      params.args.data = Array.isArray(args.data)
        ? args.data.map((row) => encryptWrite(model, row))
        : encryptWrite(model, args.data);
    }
    if (args.where) params.args.where = rewriteWhere(model, args.where);
    if (args.create) params.args.create = encryptWrite(model, args.create);
    if (args.update) params.args.update = encryptWrite(model, args.update);
  }

  const result = await next(params);

  if (action === 'count' || action === 'aggregate' || action === 'groupBy') return result;
  return decryptRelations(model && ENCRYPTED[model] ? decryptRead(model, result) : result);
});

async function connectDatabase() {
  await prisma.$connect();
  logger.info('Database connected');
}

async function disconnectDatabase() {
  await prisma.$disconnect();
  logger.info('Database disconnected');
}

module.exports = { connectDatabase, disconnectDatabase, prisma };
