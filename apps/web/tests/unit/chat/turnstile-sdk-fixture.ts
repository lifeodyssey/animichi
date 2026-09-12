import { vi } from "vitest";
import type { TurnstileOptions } from "../../../src/features/chat/components/turnstile-sdk";

export function installTurnstileSdk() {
  let sequence = 0;
  const render = vi.fn((_container: HTMLElement, _options: TurnstileOptions) => String(++sequence));
  const sdk = { render, remove: vi.fn(), reset: vi.fn() };
  window.turnstile = sdk;
  return sdk;
}

export function renderedOptions(sdk: ReturnType<typeof installTurnstileSdk>, index = 0): TurnstileOptions {
  const call = sdk.render.mock.calls[index];
  if (!call) throw new Error("The test expected a mounted widget");
  return call[1];
}

export function controlWidgetWidth(initialWidth: number) {
  let width = initialWidth, notify = () => undefined;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 0, width, 65));
  class Observer {
    constructor(callback: () => undefined) { notify = callback; }
    observe(): void { /* The test explicitly delivers each measured resize. */ }
    disconnect(): void { /* Browser cleanup is represented by the widget removal assertion. */ }
  }
  vi.stubGlobal("ResizeObserver", Observer);
  return (nextWidth: number) => { width = nextWidth; notify(); };
}
