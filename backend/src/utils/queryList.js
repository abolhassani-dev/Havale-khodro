const Joi = require('joi');

/**
 * A filter that takes several values at once, as one comma-separated word in
 * the address bar: `?carModelIds=cm1,cm2`.
 *
 * An agency deals two or three models, not one, and «برند + مدل» as single
 * choices meant running the same search three times and comparing by memory.
 * The list travels in the URL so a search is still one shareable address, and
 * it is validated word by word: an unknown or malformed entry is refused,
 * never quietly dropped — a filter that silently ignores half of what it was
 * given shows the wrong market and says nothing.
 */

const MAX_ITEMS = 25;

function listOf(pattern, { max = MAX_ITEMS, maxLength = 40 } = {}) {
  return Joi.string()
    .trim()
    .max((maxLength + 1) * max)
    .custom((value, helpers) => {
      const words = [...new Set(value.split(',').map((w) => w.trim()).filter(Boolean))];
      if (!words.length || words.length > max) return helpers.error('any.invalid');
      if (words.some((w) => w.length > maxLength || !pattern.test(w))) {
        return helpers.error('any.invalid');
      }
      return words;
    });
}

/** Catalogue identifiers — cuid-shaped, so a strict character set. */
const idList = (options) => listOf(/^[A-Za-z0-9_-]+$/u, options);

/** Names chosen from a fixed catalogue list — colours, for instance. */
const nameList = (options) =>
  listOf(/^[^,<>]+$/u, { maxLength: 60, max: 12, ...(options || {}) });

module.exports = { idList, nameList };
