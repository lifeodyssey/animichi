/**
 * Pre-hydration theme init, shipped as an inline <head> script from the root
 * route so EVERY page (not just the landing tree) honors the stored day/night
 * preference — and the landing page stops flashing the day default.
 *
 * The script must be self-contained (it runs before any module loads), so its
 * `localStorage` reference lives inside the emitted string. That is the one
 * documented storage exception outside the adapter allowlist: the key itself
 * is owned by `features/config/lib/theme-storage.ts`, and every real read and
 * write goes through that adapter.
 */

import { THEME_STORAGE_KEY } from "../features/config/lib/theme-storage";

export const THEME_BOOTSTRAP_SCRIPT =
  `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");` +
  `if(t==="day"||t==="night"){document.documentElement.dataset.theme=t;}}catch(e){}})();`;
