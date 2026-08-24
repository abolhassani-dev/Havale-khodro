/**
 * What an edit actually changed.
 *
 * Before this, an edit recorded the word «ویرایش کرد» and nothing else. An
 * agency could move a listing from fifty million toman to eighty and the log
 * would say the same thing it says for a corrected spelling — which makes the
 * audit trail useless for the one situation it exists for, because arguments
 * are always about what a number used to be.
 *
 * ── What is stored, and what is not ─────────────────────────────────────────
 *
 * Only fields that moved. An edit that changes nothing writes no diff at all,
 * so the column costs nothing on the common case of somebody opening a form and
 * saving it unchanged.
 *
 * The Persian label is stored *with* the entry rather than looked up when the
 * log is read. It is a few bytes, and it means a row written today still reads
 * correctly in two years after a field has been renamed or a market retired —
 * the same reasoning that puts the agency's name in the archive file rather
 * than only its id.
 */

/**
 * Comparable form.
 *
 * Prisma hands back Decimal for money and Date for times, and neither compares
 * with `===` against the plain number or string that arrives in a request body.
 * Without this every edit would report every money field as changed.
 */
function normalise(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  // Money is BigInt in this schema. Left alone it survives to the JSON column
  // as a string, so the same amount reads as `"50000000"` coming out and
  // `50000000` going in — which is a difference the interface would have to
  // paper over. Toman amounts are capped at a hundred billion, comfortably
  // inside what a Number holds exactly.
  if (typeof value === 'bigint') return Number(value);
  // Prisma's Decimal, and anything else that knows its own string form.
  if (typeof value === 'object' && typeof value.toString === 'function') {
    const text = value.toString();
    return Number.isNaN(Number(text)) ? text : Number(text);
  }
  return value;
}

const same = (a, b) => normalise(a) === normalise(b) || String(a ?? '') === String(b ?? '');

/**
 * @param {object} before  the record as it was
 * @param {object} after   the payload being applied — only its own keys are
 *                         considered, so a partial update reports only what it
 *                         actually touched
 * @param {object} spec    { fieldName: [label, kind] } — kind is 'money',
 *                         'date', 'number' or omitted for text
 * @returns {Array<{field, label, kind?, from, to}>}
 */
function diffOf(before, after, spec) {
  const out = [];

  for (const [field, [label, kind]] of Object.entries(spec)) {
    if (after[field] === undefined) continue;
    if (same(before?.[field], after[field])) continue;

    out.push({
      field,
      label,
      ...(kind ? { kind } : {}),
      from: normalise(before?.[field]),
      to: normalise(after[field]),
    });
  }

  return out;
}

module.exports = { diffOf };
