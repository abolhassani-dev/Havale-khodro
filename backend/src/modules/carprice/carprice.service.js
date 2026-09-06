const config = require('../../config');
const logger = require('../../utils/logger');
const { startOfTehranDay } = require('../../utils/time');
const { AppError, NotFoundError } = require('../../errors/AppError');
const { ERROR_CODES } = require('../../constants/errorCodes');
const { MESSAGES } = require('../../constants/messages');
const carPriceRepository = require('./carprice.repository');
const { parsePage, headingProblem } = require('./carprice.parser');
const { fetchPage } = require('./carprice.fetch');
const { priceKey, buildFamilies, bestMatch } = require('./carprice.link');

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

/** Above this many of our models on one price line, the line is too vague to use. */
const MAX_MODELS_PER_LINE = 3;

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
          // Rewritten every run, so a change to the folding rule corrects
          // every row by itself rather than needing a backfill.
          familyKey: priceKey(p.name),
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
        sourceStamp: parsed.stamp,
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
        // When the list itself says how old it is, that is the date a dealer
        // means by «قیمت روز» — the moment we happened to look is a fact
        // about us, not about the prices. Staleness still comes from our own
        // run, so a fetch that quietly stopped is still caught.
        pricedAt: run?.sourceStamp || null,
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

  /**
   * Point every catalogue model at the price line that covers it.
   *
   * Run after a successful fetch, so a new model or a new line is picked up
   * without anybody doing anything. Two things it will not do: touch a model
   * an admin has set by hand, and guess. Where the answer is not clear the
   * link is cleared rather than left as it was — a car whose line disappeared
   * from the source must stop showing that line's last known price.
   */
  async relink({ dryRun = false } = {}) {
    const [items, models] = await Promise.all([
      carPriceRepository.allItems(),
      carPriceRepository.linkableModels(),
    ]);
    const families = buildFamilies(items);

    const wanted = new Map();
    for (const m of models) {
      const match = bestMatch(
        { name: m.name, brand: m.brand?.name || '', bodyType: m.bodyType },
        families
      );
      wanted.set(m.id, match ? match.key : null);
    }

    // A line claimed by too many of our models is not describing any of them.
    // Measured: one «آکورد» line is claimed by thirteen cars from a Crosstour
    // to a DX, one «X3» by seven from an X3 20 to an X3 35, one «E200» by four
    // including the coupé and the convertible. Those are not one price. Two or
    // three is the ordinary case and stays — «پژو 207 اتوماتیک TU5» and
    // «TU5P» are one car as far as the market is concerned.
    const claims = new Map();
    for (const key of wanted.values()) {
      if (key) claims.set(key, (claims.get(key) || 0) + 1);
    }
    const tooVague = new Set([...claims].filter(([, n]) => n > MAX_MODELS_PER_LINE).map(([k]) => k));

    const changes = [];
    let linked = 0;
    for (const m of models) {
      const key = wanted.get(m.id);
      const next = key && !tooVague.has(key) ? key : null;
      if (next) linked += 1;
      if (next !== m.priceKey) changes.push({ id: m.id, priceKey: next });
    }

    if (!dryRun && changes.length) await carPriceRepository.setPriceKeys(changes);
    return {
      models: models.length,
      linked,
      changed: changes.length,
      droppedAsVague: tooVague.size,
      dryRun,
    };
  },

  /**
   * What the market says a catalogue model is worth today.
   *
   * A range, not a single figure: several rows can name the same car — a wheel
   * choice, the same model listed twice — and the honest answer spans them.
   *
   * Nothing comes back for a model with no link, and nothing at all for any
   * model while our own snapshot is behind. A price carrying yesterday's date
   * beside somebody's advertisement is worse than no price.
   *
   * @param {string[]} modelIds
   * @returns {Promise<Map<string, {min:number,max:number,rows:number,name:string}>>}
   */
  async marketFor(modelIds) {
    const out = new Map();
    const ids = [...new Set((modelIds || []).filter(Boolean))];
    if (!ids.length) return out;

    const [runs, models] = await Promise.all([
      Promise.all(GROUPS.map((g) => carPriceRepository.lastOkRun(g))),
      carPriceRepository.priceKeysOf(ids),
    ]);
    const times = runs.filter(Boolean).map((r) => new Date(r.finishedAt).getTime());
    if (!times.length || Date.now() - Math.min(...times) > config.carPrices.staleAfterMs) return out;

    const keys = [...new Set(models.map((m) => m.priceKey).filter(Boolean))];
    if (!keys.length) return out;

    const rows = await carPriceRepository.itemsByFamilyKeys(keys);
    const byKey = new Map();
    for (const row of rows) {
      if (row.priceToman === null || row.priceToman === undefined) continue;
      const price = Number(row.priceToman);
      const seen = byKey.get(row.familyKey);
      if (!seen) byKey.set(row.familyKey, { min: price, max: price, rows: 1, name: row.name });
      else {
        seen.min = Math.min(seen.min, price);
        seen.max = Math.max(seen.max, price);
        seen.rows += 1;
      }
    }
    for (const m of models) {
      const found = m.priceKey ? byKey.get(m.priceKey) : null;
      if (found) out.set(m.id, { ...found });
    }
    return out;
  },

  /**
   * The id a starred list is kept under: the account that starred, always.
   *
   * It was the parent's for a while, so a head office and its branches shared
   * one list. That reads as a broadcast — the head office stars six cars and
   * every branch finds them at the top of its own screen — when the star is a
   * private bookmark: the cars *this* person is watching today. Branches watch
   * different cars, and one of them clearing the list for everyone is worse
   * than each keeping its own.
   */
  ownerOf(user) {
    return user.id;
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

  /**
   * Whether this group's failure is worth a message — and remembering that we
   * sent one.
   *
   * A failure that follows a good run is news, and goes out at once. After
   * that it is the same outage saying the same thing, and once every few
   * hours is enough: the alert exists so somebody looks, not so the phone
   * buzzes ninety-six times before morning.
   *
   * Each group decides for itself. One page being down for a week must not
   * silence the first failure of the other.
   */
  async shouldAlert(group, now = new Date()) {
    const [mark, ok] = await Promise.all([
      carPriceRepository.lastAlertAt(group),
      carPriceRepository.lastOkRun(group),
    ]);
    // The mark belongs to this outage if nothing has succeeded since it.
    const sameOutage = mark && (!ok || mark.getTime() >= new Date(ok.finishedAt).getTime());
    if (sameOutage && now.getTime() - mark.getTime() < config.carPrices.alertCooldownMs) {
      return false;
    }
    await carPriceRepository.markAlerted(group, now);
    return true;
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
