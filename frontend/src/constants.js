/**
 * Brand, mirroring the backend's `constants/brand.js`.
 *
 * Two copies is not ideal, but the alternative is an API call before the sign-in
 * page can draw its own header — a request nobody is authenticated for, on the
 * only screen a first-time visitor sees. A name that changes twice a decade is
 * worth that duplication.
 */
export const BRAND = {
  name: 'FeranoCar',
  nameFa: 'فرانوکار',
  domain: 'feranocar.com',
};

/** Kept in step with the server's own validation, purely so the user is told
 *  before submitting rather than after. The server checks regardless. */
export const LIMITS = {
  passwordMin: 8,
  reportDescriptionMin: 20,
  depositDaysMin: 1,
  depositDaysMax: 30,
};

/**
 * The deepest numbered page the server will serve — mirrors `MAX_PAGE` in the
 * backend's `constants/havale.js`.
 *
 * It has to be here as well as there: the total page count the server reports
 * is honest — three hundred pages means three hundred pages — but the query
 * validator refuses anything past fifty. A pager that drew a button for page
 * three hundred would be drawing a button that answers 422, which is precisely
 * the sort of dead control this panel has been bitten by before. So the pager
 * stops at fifty and says why.
 */
export const MAX_PAGE = 50;
