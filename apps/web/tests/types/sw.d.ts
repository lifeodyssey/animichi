/**
 * Ambient module declaration for the classic-script service worker.
 * `public/` is outside the TS project (no allowJs); the unit suite imports
 * `public/sw.js` purely for its listener side effects, so it has no exports.
 */
declare module "*/public/sw.js" {
  const nothing: Record<string, never>;
  export default nothing;
}
