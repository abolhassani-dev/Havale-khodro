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
