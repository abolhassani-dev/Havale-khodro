/**
 * Counting things per address, in memory, without growing forever.
 *
 * ── Why not the database ────────────────────────────────────────────────────
 *
 * The behavioural rules — five failed passwords in a quarter of an hour, forty
 * refusals from one address — all need "how many, recently". Asking Postgres
 * that on every request would put a query on the hot path of every sign-in and
 * every refusal, which is exactly the shape of load an attacker is trying to
 * create. Counting in memory costs a Map lookup, and the number is only written
 * down when a threshold is actually crossed.
 *
 * What is lost by keeping it in memory: the counters reset when the API
 * restarts. That is acceptable — a restart is rare, and the window is minutes.
 * What is *not* lost is anything already recorded, which is in the database.
 *
 * ── Why a fixed window and not a sliding one ────────────────────────────────
 *
 * A sliding window needs a list of timestamps per key; a fixed window needs one
 * integer. The difference in accuracy is that an attack straddling a window
 * boundary can need up to twice the threshold to trigger — and the difference in
 * cost is a list per address versus a number. On this machine that trade is not
 * close.
 *
 * ── The ceiling ─────────────────────────────────────────────────────────────
 *
 * A distributed attack would otherwise create one entry per source address and
 * turn this into the memory leak it exists to report. The map is capped, and
 * when it is full the oldest window is dropped — so the worst case is that some
 * counting stops, not that the process dies.
 */

const MAX_KEYS = 5000;

/** A counter set with one window length. */
function windowCounter(windowMs) {
  const hits = new Map();

  /** Drop everything whose window has passed. Called on write, not on a timer. */
  function sweep(now) {
    for (const [key, entry] of hits) {
      if (now - entry.startedAt >= windowMs) hits.delete(key);
    }
  }

  return {
    /**
     * Count one, and say how many there are in this window.
     * @returns {number} the count including this one
     */
    hit(key, now = Date.now()) {
      const entry = hits.get(key);

      if (!entry || now - entry.startedAt >= windowMs) {
        if (hits.size >= MAX_KEYS) sweep(now);
        // Still full after a sweep: a genuinely distributed source. Counting
        // stops rather than memory growing — the events already recorded stand.
        if (hits.size >= MAX_KEYS) return 1;
        hits.set(key, { startedAt: now, count: 1, seen: null });
        return 1;
      }

      entry.count += 1;
      return entry.count;
    },

    /**
     * Count one *distinct* value under a key, and say how many distinct ones
     * there are in this window. This is what separates password spraying —
     * one address, many usernames — from an ordinary forgotten password.
     */
    hitDistinct(key, value, now = Date.now()) {
      const entry = hits.get(key);

      if (!entry || now - entry.startedAt >= windowMs) {
        if (hits.size >= MAX_KEYS) sweep(now);
        if (hits.size >= MAX_KEYS) return 1;
        hits.set(key, { startedAt: now, count: 1, seen: new Set([value]) });
        return 1;
      }

      if (!entry.seen) entry.seen = new Set();
      entry.seen.add(value);
      entry.count = entry.seen.size;
      return entry.seen.size;
    },

    /** Tests only. */
    clear() {
      hits.clear();
    },

    get size() {
      return hits.size;
    },
  };
}

module.exports = { windowCounter, MAX_KEYS };
