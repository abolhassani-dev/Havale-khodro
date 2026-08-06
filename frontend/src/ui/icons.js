import { raw } from './html.js';

/**
 * Inline SVG icons, stroke-based, drawn on a 24-unit grid.
 *
 * These replace the unicode glyphs (▦ ⌕ ⛁ …) the sidebar started with. A
 * glyph renders differently on every platform's fallback font and at small
 * sizes turns to noise; a stroke inherits `currentColor`, scales cleanly, and
 * looks the same on every device. No icon font and no CDN — the CSP allows
 * nothing off-origin, and fifteen small paths cost less than either.
 */

const PATHS = {
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  inbox: '<path d="M12 3v10m0 0l-4-4m4 4l4-4"/><path d="M3 15v3a2 2 0 002 2h14a2 2 0 002-2v-3"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 15.5c2.4.3 4.3 1.8 5 4.5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h12l-2.5 4L17 12H5"/>',
  car: '<path d="M5 16l1.3-5.2A2 2 0 018.2 9h7.6a2 2 0 011.9 1.8L19 16"/><rect x="3.5" y="15.5" width="17" height="4" rx="1.5"/><path d="M7 19.5V21M17 19.5V21"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.6-3.1 7.8-7.5 9.5-4.4-1.7-7.5-4.9-7.5-9.5V6L12 3z"/>',
  ticket: '<path d="M3 9V7a2 2 0 012-2h14a2 2 0 012 2v2a2 2 0 000 6v2a2 2 0 01-2 2H5a2 2 0 01-2-2v-2a2 2 0 000-6z"/><path d="M14 5v14"/>',
  file: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z"/><path d="M14 3v5h5"/>',
  clipboard: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3.5A1.5 1.5 0 0110.5 2h3A1.5 1.5 0 0115 3.5V4"/><path d="M9 11h6M9 15h4"/>',
  wrench: '<path d="M15.5 3.5a5.5 5.5 0 00-6.7 7L3 16.3V21h4.7l5.8-5.8a5.5 5.5 0 007-6.7l-3.2 3.2-2.8-.7-.7-2.8 3.2-3.2z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c.9-4 4.1-6 8-6s7.1 2 8 6"/>',
  // Points down; the stylesheet rotates it a quarter turn when the group is
  // closed, so one icon covers both states and they can never disagree.
  chevron: '<path d="M6 9l6 6 6-6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};

export function icon(name, size = 17) {
  const paths = PATHS[name];
  if (!paths) return raw('');
  return raw(
    `<svg class="svgi" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
      `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ` +
      `aria-hidden="true">${paths}</svg>`
  );
}
