/**
 * Which markets exist, and how the shared parts of the system read them.
 *
 * The moderation desk is one desk: every market's advertisements are suspended,
 * removed and audited the same way, by the same people, through the same
 * screens. But the desk must not have to know what a «طرح» is, or a «صلح» —
 * so each market registers itself here with two small things: what to call it,
 * and how to turn one of its rows into labelled facts a person can read.
 *
 * The dependency points the right way round. The kernel never imports a market;
 * a market imports the kernel and announces itself when its module loads. That
 * is what makes adding خودرو or قطعات a new folder rather than an edit to five
 * shared files — and what stops a change in one market reaching another.
 */

const markets = new Map();

/**
 * @param {string} key                 the value stored in Listing.market
 * @param {object} descriptor
 * @param {string} descriptor.label    what to call this market in the panel
 * @param {object} [descriptor.include] extra Prisma include for its detail row
 * @param {(row: object) => Array<{label: string, value: any}>} descriptor.describe
 *        the market's own fields, for the admin's detail page
 * @param {(row: object) => object} [descriptor.summarise]
 *        the few fields its row in the admin list needs
 */
function registerMarket(key, descriptor) {
  markets.set(key, descriptor);
}

function marketOf(key) {
  return markets.get(key) || null;
}

/** Every registered market, for the menu and the filters. */
function allMarkets() {
  return [...markets.entries()].map(([key, d]) => ({ key, label: d.label }));
}

/**
 * One include covering every market's detail table.
 *
 * A query cannot vary its include per row, so the admin list asks for all of
 * them; a حواله row simply carries `registration: null`. Cheap, and it keeps
 * the shared query free of any single market's name.
 */
function detailInclude() {
  return [...markets.values()].reduce((all, d) => ({ ...all, ...(d.include || {}) }), {});
}

module.exports = { registerMarket, marketOf, allMarkets, detailInclude };
