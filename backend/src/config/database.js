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

/**
 * Retry a query the connection dropped underneath, and only that.
 *
 * When Postgres restarts, the queries already in flight fail with a connection
 * error. Nothing is wrong with them — the same query a second later succeeds.
 * Without this, a database restart that lasts two seconds shows up as an error
 * page for whoever happened to be clicking.
 *
 * Deliberately narrow, because a retry in the wrong place is worse than none:
 *
 *   - Only connection-level errors. P1001 cannot reach the server, P1017 the
 *     server closed the connection. A constraint violation or a timeout is a
 *     real answer and must be returned, not retried.
 *   - Only reads. Replaying a create that may have committed before the
 *     connection dropped would duplicate a havale or a payment. A failed write
 *     is the user's to retry, with a button and their own judgement.
 *
 * Registered first so it wraps the encryption middleware below: a retried query
 * goes through the whole chain again, rather than re-running a half-processed one.
 */
const RETRYABLE_CODES = new Set(['P1001', 'P1017']);
const READ_ACTIONS = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow',
  'findMany', 'count', 'aggregate', 'groupBy',
]);

prisma.$use(async (params, next) => {
  if (!READ_ACTIONS.has(params.action)) return next(params);

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await next(params);
    } catch (err) {
      if (!RETRYABLE_CODES.has(err.code)) throw err;
      lastError = err;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    }
  }
  logger.warn('Read failed after 3 attempts', {
    model: params.model,
    action: params.action,
    code: lastError?.code,
  });
  throw lastError;
});

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

/**
 * Connect, waiting for the database rather than giving up on it.
 *
 * Postgres takes a few seconds to start accepting connections, and it restarts
 * on its own for reasons that have nothing to do with us — a backup, a package
 * upgrade, the kernel reclaiming memory. The previous version called $connect
 * once; a failure reached start()'s catch and exited the process. Docker's
 * restart policy then brought it back, which *worked*, but as a crash loop:
 * the API flapped for as long as the database took, and every flap was a burst
 * of failed requests for whoever was using the panel at the time.
 *
 * Waiting is the cheaper answer. Roughly a minute of backoff covers every
 * restart we have actually seen; past that, exiting is right, because the
 * problem is not "starting up" any more and a container that keeps trying
 * hides it.
 */
async function connectDatabase({ retries = 10, baseDelayMs = 500 } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await prisma.$connect();
      if (attempt > 1) logger.info(`Database connected after ${attempt} attempts`);
      else logger.info('Database connected');
      return;
    } catch (err) {
      if (attempt >= retries) {
        logger.error('Database unreachable, giving up', { attempts: attempt, error: err.message });
        throw err;
      }
      // Capped exponential backoff: 0.5s, 1s, 2s, 4s, 8s, then 10s each.
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), 10000);
      logger.warn(`Database not ready (attempt ${attempt}/${retries}), retrying in ${delay}ms`, {
        error: err.message,
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function disconnectDatabase() {
  await prisma.$disconnect();
  logger.info('Database disconnected');
}

module.exports = { connectDatabase, disconnectDatabase, prisma };
