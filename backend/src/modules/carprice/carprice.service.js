const config = require('../../config');
const logger = require('../../utils/logger');
const { startOfTehranDay } = require('../../utils/time');
const { AppError, NotFoundError } = require('../../errors/AppError');
const { ERROR_CODES } = require('../../constants/errorCodes');
const { MESSAGES } = require('../../constants/messages');
const carPriceRepository = require('./carprice.repository');
const { parsePage, headingProblem } = require('./carprice.parser');
const { fetchPage } = require('./carprice.fetch');

/**
 * The market price list, kept as a snapshot and served from it.
 *
 * Two halves. `refresh` is what the hourly job calls: fetch one page, parse
 * it, decide whether to believe it, write it. `snapshot` is what the panel
 * reads: the last believed list, with the time it was believed. Nothing the
 * panel does can cause a fetch — that is the whole performance story, and it
 * is a design fact rather than a cache setting.
 *
 * Believing a page is the part that deserves care. The source is somebody
 * else's website; a maintenance page, a block page or a redesign all come
 * back as HTTP 200 with the wrong thing in them. So a page has to have at
 * least a floor's worth of rows, and at least half of what the last good page
 * had, or nothing is written and the previous snapshot stays with its own,
 * honest timestamp. A stale list with a visible date is a fact; an empty list
 * with today's date is a lie.
 */

const GROUPS = ['DOMESTIC', 'IMPORTED'];

/** The previous snapshot's price, the new one, and what the source said. */
function directionOf(oldItem, parsed) {
  const was = oldItem?.priceToman ?? null;
  const now = parsed.priceToman;
  if (was !== null && now !== null && was !== now) return now > was ? 'UP' : 'DOWN';
  // Unchanged since our last look — usually the case hour to hour — so the
  // day's movement is whatever the source says it is.
  return parsed.direction;
}

const same = (a, b) => (a === null || a === undefined ? b === null || b === undefined : a === b);

const carPriceService = {
  GROUPS,

  /**
   * One group, one page, one decision.
   *
   * @param {'DOMESTIC'|'IMPORTED'} group
   * @param {object} [opts]
   * @param {string} [opts.html]   a page already in hand (tests, `--file`), instead of fetching
   * @param {boolean} [opts.dryRun] parse and judge, write nothing
   */
  async refresh(group, { html = null, dryRun = false } = {}) {
    if (!GROUPS.includes(group)) throw new Error(`unknown price group: ${group}`);
    const url = config.carPrices.sources[group];
    const run = dryRun ? null : await carPriceRepository.startRun(group);

    try {
      const page = html ?? (await fetchPage(url));
      const parsed = parsePage(page);
      const last = await carPriceRepository.lastOkRun(group);

      // The gates. Each one turns a way the page could be wrong into a
      // refusal with a sentence, instead of a wrong number on a screen. The
      // previous snapshot — with its own, honest timestamp — is what stays.
      const KEPT = ' — به‌روزرسانی نشد و فهرست قبلی سر جایش ماند';
      const structure = headingProblem(parsed.headings);
      if (structure) throw new Error(structure + KEPT);

      const floor = Math.max(config.carPrices.minItems, last ? Math.ceil(last.itemCount / 2) : 0);
      if (parsed.items.length < floor) {
        throw new Error(
          `صفحه فقط ${parsed.items.length} ردیف داشت` +
            (last ? ` (دفعه‌ی قبل ${last.itemCount})` : '') +
            KEPT
        );
      }

      const priced = parsed.items.filter((i) => i.priceToman !== null).length;
      if (priced < parsed.items.length * 0.6) {
        throw new Error(`فقط ${priced} از ${parsed.items.length} ردیف قیمت داشت` + KEPT);
      }

      const now = new Date();
      const ids = parsed.items.map((i) => i.id);
      const [existing, withPointToday] = await Promise.all([
        carPriceRepository.itemsByIds(ids),
        carPriceRepository.itemsWithHistorySince(ids, startOfTehranDay(now)),
      ]);
      const before = new Map(existing.map((row) => [row.id, row]));

      // A unit change — the source switching to rial, a dropped zero across
      // the board — moves everything at once by a lot. A real market never
      // does that inside one hour.
      const wild = parsed.items.filter((p) => {
        const was = before.get(p.id)?.priceToman;
        if (was === null || was === undefined || p.priceToman === null || was === 0n) return false;
        const ratio = Number(p.priceToman) / Number(was);
        return ratio > 1.3 || ratio < 0.7;
      }).length;
      if (before.size >= config.carPrices.minItems && wild > before.size * 0.2) {
        throw new Error(`${wild} قیمت در یک ساعت بیش از ۳۰٪ جابه‌جا شده‌اند` + KEPT);
      }

      let changed = 0;
      const history = [];
      const items = parsed.items.map((p) => {
        const old = before.get(p.id);
        const moved = !old || !same(old.priceToman, p.priceToman);
        if (moved && old) changed += 1;
        // One point per change, and one a day regardless: the chart that will
        // read these needs to know a price *held* as much as that it moved.
        if (moved || !withPointToday.has(p.id)) {
          history.push({ itemId: p.id, priceToman: p.priceToman, at: now });
        }
        return {
          id: p.id,
          group,
          brand: p.brand || '',
          name: p.name,
          priceToman: p.priceToman,
          priceText: p.priceText,
          secondToman: p.secondToman,
          secondText: p.secondText,
          changeToman: p.changeToman,
          changePct: p.changePct,
          direction: directionOf(old, p),
          prevToman: moved && old ? old.priceToman : (old?.prevToman ?? null),
          sortOrder: p.sortOrder,
          seenAt: now,
          changedAt: moved && old ? now : (old?.changedAt ?? null),
        };
      });

      const summary = {
        group,
        ok: true,
        items: items.length,
        changed,
        newItems: items.filter((i) => !before.has(i.id)).length,
        secondLabel: parsed.secondLabel,
        stamp: parsed.stamp,
        dryRun,
      };
      if (dryRun) return summary;

      await carPriceRepository.writeSnapshot({
        runId: run.id,
        items,
        history,
        secondLabel: parsed.secondLabel,
        changed,
      });
      logger.info(`car prices: ${group} ${items.length} rows, ${changed} changed, ${history.length} points`);
      return summary;
    } catch (err) {
      if (run) {
        await carPriceRepository
          .finishRun(run.id, { ok: false, error: String(err.message).slice(0, 500) })
          .catch(() => {});
      }
      throw err;
    }
  },

  /**
   * What the panel shows: both groups, the last good time of each, and
   * whether that time is old enough to say so.
   */
  async snapshot() {
    const now = Date.now();
    const [runs, rows] = await Promise.all([
      Promise.all(GROUPS.map((g) => carPriceRepository.lastOkRun(g))),
      carPriceRepository.listSeenSince(new Date(now - config.carPrices.dropAfterMs)),
    ]);

    const groups = {};
    GROUPS.forEach((group, i) => {
      const run = runs[i];
      groups[group] = {
        updatedAt: run?.finishedAt || null,
        secondLabel: run?.secondLabel || null,
        items: rows.filter((r) => r.group === group).map(toItem),
      };
    });

    const times = runs.filter(Boolean).map((r) => new Date(r.finishedAt).getTime());
    const updatedAt = times.length ? new Date(Math.min(...times)) : null;
    return {
      updatedAt,
      stale: !updatedAt || now - updatedAt.getTime() > config.carPrices.staleAfterMs,
      groups,
    };
  },

  /** The id an agency's list is kept under: the parent's, for a sub-agency. */
  ownerOf(user) {
    return user.parentId || user.id;
  },

  async watchList(user) {
    const rows = await carPriceRepository.watchIds(this.ownerOf(user));
    return rows.map((r) => r.itemId);
  },

  async watch(user, itemId) {
    const owner = this.ownerOf(user);
    if (!(await carPriceRepository.itemExists(itemId))) {
      throw new NotFoundError('خودرو');
    }
    const count = await carPriceRepository.watchCount(owner);
    const limit = config.carPrices.watchLimit;
    if (count >= limit) {
      throw new AppError(
        MESSAGES.CAR_PRICES.WATCH_LIMIT.replace('{n}', String(limit)),
        400,
        ERROR_CODES.VALIDATION
      );
    }
    await carPriceRepository.addWatch(owner, itemId);
    return this.watchList(user);
  },

  async unwatch(user, itemId) {
    await carPriceRepository.removeWatch(this.ownerOf(user), itemId);
    return this.watchList(user);
  },

  /** Nightly: points older than the retention window. */
  async pruneHistory(days = config.retention.days.carPriceHistory) {
    const { count } = await carPriceRepository.pruneHistoryBefore(
      new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    );
    return count;
  },
};

/** BigInt → number for JSON; every price fits in a double with room to spare. */
const num = (v) => (v === null || v === undefined ? null : Number(v));

function toItem(row) {
  return {
    id: row.id,
    group: row.group,
    brand: row.brand,
    name: row.name,
    price: num(row.priceToman),
    priceText: row.priceText,
    second: num(row.secondToman),
    secondText: row.secondText,
    change: num(row.changeToman),
    changePct: row.changePct === null ? null : Number(row.changePct),
    direction: row.direction,
    prev: num(row.prevToman),
    changedAt: row.changedAt,
    sortOrder: row.sortOrder,
  };
}

module.exports = carPriceService;
