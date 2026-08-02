/**
 * Time, from the user's point of view.
 *
 * "Thirty reveals per day" means a day as the agent in Tehran experiences it,
 * not a UTC day. Getting this wrong is not a rounding error: with a UTC day the
 * cap would reset at 3:30 in the morning local time, so an agent working the
 * evening would find their allowance vanish at 20:30 and someone would spend a
 * long afternoon trying to reproduce it.
 *
 * The offset is read from the timezone database rather than hard-coded at
 * +03:30, because a hard-coded offset is wrong the day the rule changes and
 * nobody remembers this file exists.
 */

const TEHRAN = 'Asia/Tehran';

const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: TEHRAN,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function tehranParts(date) {
  const parts = Object.fromEntries(PARTS.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Intl renders midnight as hour 24 in some locales; % 24 normalises it.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** How far Tehran is ahead of UTC at this instant, in milliseconds. */
function tehranOffsetMs(date) {
  const p = tehranParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Midnight in Tehran on the calendar day containing `date`. */
function startOfTehranDay(date = new Date()) {
  const offset = tehranOffsetMs(date);
  const shifted = new Date(date.getTime() + offset);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - offset);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

module.exports = { TEHRAN, startOfTehranDay, tehranOffsetMs, addDays };
