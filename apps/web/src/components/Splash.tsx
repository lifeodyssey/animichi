import type { ReactElement } from "react";

/** Static, system-themed splash; dismissal is driven by CSS, never a JS timer.
 * `hold` marks the index route; CSS applies the extended hold only when the
 * initial viewport is mobile, where `/` hands off until chat paints and releases
 * it. Desktop gets the plain dismissal and stays on the clickable doorway.
 *
 * 2026-08-30: restyled onto the direction-E green ground (leaf tile + ink on
 * green). One frame serves both themes — colors come from the day/night rules
 * in globals.css, not from duplicated markup. No mascot this round (owner). */
function SplashCenter(): ReactElement {
  return (
    <div className="app-splash__center">
      <span className="app-splash__wordmark">Animichi</span>
      <strong className="app-splash__title">聖地巡礼</strong>
      <span className="app-splash__tagline">あの画面に、行こう。</span>
    </div>
  );
}

function SplashFooter(): ReactElement {
  return (
    <div className="app-splash__footer">
      <span className="app-splash__bar" />
      <small>画像・座標:Anitabi (CC BY-NC-SA 4.0)</small>
    </div>
  );
}

export function Splash({ hold = false }: { readonly hold?: boolean }): ReactElement {
  return (
    <div className="app-splash" data-splash="static" data-splash-hold={hold ? "handoff" : undefined} aria-hidden="true">
      <SplashCenter />
      <SplashFooter />
    </div>
  );
}
