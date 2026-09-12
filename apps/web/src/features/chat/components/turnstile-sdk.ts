import { useEffect } from "react";
import type { RefObject } from "react";

/** Explicit rendering supports remounts and the vendor's two responsive size variants. */
export const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
export type TurnstileSize = "flexible" | "compact";
export interface TurnstileConfig {
  readonly sitekey: string;
  readonly action: string;
  readonly appearance: "interaction-only";
  readonly theme: "light" | "dark";
  readonly language: string;
}
export interface TurnstileOptions extends TurnstileConfig {
  readonly size: TurnstileSize;
  readonly callback: (token: string) => void;
  readonly "error-callback": () => void;
  readonly "expired-callback": () => void;
  readonly "timeout-callback": () => void;
  readonly "before-interactive-callback": () => void;
  readonly "after-interactive-callback": () => void;
}
export interface TurnstileApi {
  reset: (widget?: string) => void;
  render?: (container: HTMLElement, options: TurnstileOptions) => string;
  remove?: (widget: string) => void;
}
type Renderer = Required<TurnstileApi>;

function readyApi(): Renderer | undefined {
  const api = window.turnstile;
  return typeof api?.render === "function" && typeof api.remove === "function" ? api as Renderer : undefined;
}

function sdkScript(): HTMLScriptElement {
  const previous = document.head.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT_SRC}"]`);
  if (previous && previous.dataset.failed !== "true") return previous;
  previous?.remove();
  const script = document.createElement("script");
  script.src = TURNSTILE_SCRIPT_SRC;
  script.async = true; script.defer = true;
  return script;
}

function listenForSdk(script: HTMLScriptElement, signal: AbortSignal, resolve: (api: Renderer | undefined) => void): void {
  const done = () => { script.removeEventListener("load", done); script.removeEventListener("error", failed); signal.removeEventListener("abort", done); resolve(readyApi()); };
  const failed = () => { script.dataset.failed = "true"; window.onAnimichiTurnstileError?.(); done(); };
  script.addEventListener("load", done, { once: true });
  script.addEventListener("error", failed, { once: true });
  signal.addEventListener("abort", done, { once: true });
  if (!script.isConnected) document.head.appendChild(script);
}

function loadSdk(signal: AbortSignal): Promise<Renderer | undefined> {
  const api = readyApi();
  if (api) return Promise.resolve(api);
  return new Promise(resolve => { listenForSdk(sdkScript(), signal, resolve); });
}

/** Removed widgets must not deliver late callbacks to a newly mounted gate. */
function widgetCallbacks(active: () => boolean) {
  return {
    callback: (token: string) => { if (active()) window.onAnimichiTurnstile?.(token); },
    "error-callback": () => { if (active()) window.onAnimichiTurnstileError?.(); },
    "expired-callback": () => { if (active()) window.onAnimichiTurnstileExpired?.(); },
    "timeout-callback": () => { if (active()) window.onAnimichiTurnstileError?.(); },
    "before-interactive-callback": () => { if (active()) window.onAnimichiTurnstileInteractive?.(); },
    "after-interactive-callback": () => { if (active()) window.onAnimichiTurnstileInteractiveEnd?.(); },
  };
}

interface Mount {
  readonly node: HTMLDivElement;
  readonly api: Renderer;
  readonly config: TurnstileConfig;
  readonly signal: AbortSignal;
  generation: number;
  size?: TurnstileSize;
  widgetId?: string;
}

function renderSizedWidget(mount: Mount): void {
  const width = mount.node.getBoundingClientRect().width, size = width > 0 && width < 300 ? "compact" : "flexible";
  if (size === mount.size) return;
  const generation = ++mount.generation;
  if (mount.widgetId !== undefined) mount.api.remove(mount.widgetId);
  mount.size = size;
  mount.node.dataset.size = size;
  const active = () => !mount.signal.aborted && generation === mount.generation;
  mount.widgetId = mount.api.render(mount.node, { ...mount.config, size, ...widgetCallbacks(active) });
}

function observeWidget(mount: Mount): void {
  const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => { renderSizedWidget(mount); });
  observer?.observe(mount.node);
  mount.signal.addEventListener("abort", () => {
    observer?.disconnect();
    if (mount.widgetId !== undefined) mount.api.remove(mount.widgetId);
  }, { once: true });
}

async function mountWidget(node: HTMLDivElement, config: TurnstileConfig, signal: AbortSignal): Promise<void> {
  const api = await loadSdk(signal);
  if (!api || signal.aborted) return;
  const mount: Mount = { node, api, config, signal, generation: 0 };
  renderSizedWidget(mount);
  observeWidget(mount);
}

function embedEffect(node: HTMLDivElement | null, config: TurnstileConfig): (() => void) | undefined {
  if (!node) return undefined;
  const controller = new AbortController();
  void mountWidget(node, config, controller.signal).catch(() => { if (!controller.signal.aborted) window.onAnimichiTurnstileError?.(); });
  return () => { controller.abort(); };
}

export function useTurnstileEmbed(ref: RefObject<HTMLDivElement | null>, config: TurnstileConfig, attempt: number): void {
  useEffect(() => embedEffect(ref.current, config), [ref, config, attempt]);
}
