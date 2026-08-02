/**
 * The brand, in one place.
 *
 * Everything user-facing reads these values rather than hard-coding the name, so
 * a rebrand is an edit to this file and not a search across the codebase. The
 * internal name of the project stays `havale` — the folder, the database, the
 * package — because renaming those buys nothing and breaks deployment scripts.
 *
 * The environment can override each value, which is what lets a staging box
 * announce itself as staging.
 */

const BRAND = {
  /** Latin name, for the domain, emails and English-language surfaces. */
  name: process.env.BRAND_NAME || 'FeranoCar',

  /** Persian name, for the interface and SMS. */
  nameFa: process.env.BRAND_NAME_FA || 'فرانوکار',

  domain: process.env.BRAND_DOMAIN || 'feranocar.com',

  supportEmail: process.env.BRAND_SUPPORT_EMAIL || 'support@feranocar.com',
};

module.exports = { BRAND };
