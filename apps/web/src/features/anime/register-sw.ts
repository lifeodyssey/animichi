import { useEffect } from "react";

/**
 * Registers `/sw.js` (network-first for /anime navigations, spec X7).
 * Structural navigator type: jsdom and older browsers lack `serviceWorker`,
 * so the guard is a real runtime branch, not a type-level formality.
 */
export interface SwNavigator {
  readonly serviceWorker?: { register(url: string): Promise<unknown> };
}

export function registerAnimeSw(nav: SwNavigator): void {
  if (!nav.serviceWorker) return;
  nav.serviceWorker.register("/sw.js").catch(() => undefined);
}

export function useRegisterAnimeSw(): void {
  useEffect(() => {
    registerAnimeSw(globalThis.navigator);
  }, []);
}
