import type { Page } from "@playwright/test";

/** A control the browser's own Tab reaches, with the paint it shows at rest. */
export type TabStop = Readonly<{ token: string; ring: string }>;

/** Where a Tab landed, and whether it painted something the resting read did
 * not — a focus indicator the visitor can see. */
export type FocusLanding = Readonly<{ token: string; indicated: boolean }>;

/** The tab order, plus the identity of the one control the caller is about. */
export type TabPath = Readonly<{ stops: readonly TabStop[]; marked: string }>;

type KeyboardPath = Readonly<{
  stops: readonly TabStop[];
  marked: string | null;
  focused: TabStop | null;
}>;

/**
 * One read of the keyboard path inside the route's main region: every control
 * the browser hands focus to on Tab, in tab order, each with the paint it shows
 * while it does NOT hold focus — plus where focus is now, and the identity of
 * the control `mark` names.
 *
 * The paint is a chain rather than the control's own outline because this app
 * draws the composer's ring on the pill that wraps the field (`focus-within`),
 * so a stop's indicator can live on a wrapper. Border and outline properties
 * only: a background change is not a focus cue.
 */
async function readKeyboardPath(page: Page, mark: string | null): Promise<KeyboardPath> {
  return page.evaluate((selector) => {
    const TAB_STOPS = 'a[href], button, input, select, textarea, summary, [contenteditable="true"]';
    const tokenOf = (element: Element): string =>
      `${element.tagName.toLowerCase()}:${element.getAttribute("aria-label") ?? element.textContent.trim().slice(0, 40)}`;
    const ringOf = (element: Element): string => {
      const style = getComputedStyle(element);
      return [style.outlineStyle, style.outlineWidth, style.outlineColor, style.borderColor, style.boxShadow].join("|");
    };
    const paintOf = (element: Element): string => {
      const paints = [ringOf(element)];
      for (let node = element.parentElement; node !== null && node.tagName !== "MAIN"; node = node.parentElement) paints.push(ringOf(node));
      return paints.join("||");
    };
    const main = document.getElementById("main-content");
    const reachable = (element: Element): boolean =>
      main?.contains(element) === true && element.closest("[inert]") === null && !element.matches(":disabled") &&
      element.checkVisibility() && Number(element.getAttribute("tabindex") ?? 0) >= 0;
    const stops = [...document.querySelectorAll(TAB_STOPS)].filter(reachable).map((element) => ({ token: tokenOf(element), ring: paintOf(element) }));
    const marked = selector === null ? null : document.querySelector(selector);
    const active = document.activeElement;
    return {
      stops,
      marked: marked === null ? null : tokenOf(marked),
      focused: active === null ? null : { token: tokenOf(active), ring: paintOf(active) },
    };
  }, mark);
}

/**
 * The controls Tab reaches on this page, in the order it reaches them, with the
 * quiet control `mark` names — a spec asserts that control is one of them, so a
 * page left with nothing focusable cannot make a walk over the stops vacuous.
 * Throws when nothing matches `mark`: a control a spec is about has to exist.
 */
export async function tabPath(page: Page, mark: string): Promise<TabPath> {
  const path = await readKeyboardPath(page, mark);
  if (path.marked === null) throw new Error(`the keyboard path has no control matching ${mark}`);
  return { stops: path.stops, marked: path.marked };
}

/**
 * How the control that holds focus stands against the stop the walk expected:
 * null means focus left the document, which is what an exhausted tab order
 * looks like — the zero `*:focus` count the old spec ran into.
 */
export async function focusLanding(page: Page, resting: TabStop): Promise<FocusLanding | null> {
  const { focused } = await readKeyboardPath(page, null);
  return focused === null ? null : { token: focused.token, indicated: focused.ring !== resting.ring };
}

/**
 * Wait for the paint to settle before reading a resting ring: focus is animated
 * (the composer pill transitions its border color), so a read taken while a
 * transition still runs is not the paint the visitor sees.
 */
export async function focusPaintSettled(page: Page): Promise<void> {
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"));
}
