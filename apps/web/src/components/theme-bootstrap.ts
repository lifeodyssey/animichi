/**
 * Pre-hydration theme init, shipped as an inline <head> script from the root
 * route so EVERY page (not just the landing tree) honors the stored day/night
 * preference — and the landing page stops flashing the day default.
 */

export const THEME_STORAGE_KEY = "animichi-theme";

export const THEME_BOOTSTRAP_SCRIPT =
  `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");` +
  `if(t==="day"||t==="night"){document.documentElement.dataset.theme=t;}}catch(e){}})();`;
