/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ByokProbeOutcome } from "../../../src/features/chat/byok-probe";
import { ByokSettings } from "../../../src/features/chat/components/ByokSettings";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { getByokConfig, getByokVisionSupported } from "../../../src/lib/byok/byokStorage";

const dict = chatDictFor("ja");
const KEY = "sk-secret-abcdef";

function renderPanel(outcome: ByokProbeOutcome) {
  const probe = vi.fn().mockResolvedValue(outcome);
  const view = render(
    <ByokSettings dict={dict} auth="authenticated" baseUrl="http://agent.test" probe={probe} />,
  );
  return { probe, view };
}

function fillAndSave(): void {
  fireEvent.change(screen.getByLabelText(dict.byok.apiKeyLabel), { target: { value: KEY } });
  fireEvent.change(screen.getByLabelText(dict.byok.modelLabel), { target: { value: "my-model" } });
  fireEvent.click(screen.getByRole("button", { name: dict.byok.save }));
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe("ByokSettings — save-and-probe (OQ-2: one request does both)", () => {
  it("fires exactly one probe on save and renders the vision badge on success", async () => {
    const { probe } = renderPanel({ kind: "ok", vision: true, definitive: true });
    fillAndSave();
    await waitFor(() => { expect(screen.getByText(dict.byok.visionBadge)).toBeTruthy(); });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(getByokVisionSupported()).toBe(true);
  });

  it("renders no badge when the provider has no vision support", async () => {
    renderPanel({ kind: "ok", vision: false, definitive: true });
    fillAndSave();
    await waitFor(() => { expect(getByokVisionSupported()).toBe(false); });
    expect(screen.queryByText(dict.byok.visionBadge)).toBeNull();
  });

  it("announces the in-flight check as a status line", async () => {
    renderPanel({ kind: "ok", vision: false, definitive: true });
    fillAndSave();
    expect(screen.getByRole("status").textContent).toBe(dict.byok.checking);
    await waitFor(() => { expect(screen.queryByRole("status")).toBeNull(); });
  });
});

describe("ByokSettings — key-not-accepted state (T6-AC6/AC7)", () => {
  it("renders the rejection inline, inside the panel, with the explicit copy", async () => {
    renderPanel({ kind: "rejected" });
    fillAndSave();
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(dict.byok.notAccepted);
    });
  });

  it("keeps the saved credential so the user can correct it, not retype it all", async () => {
    renderPanel({ kind: "rejected" });
    fillAndSave();
    await waitFor(() => { expect(screen.getByRole("alert")).toBeTruthy(); });
    expect(getByokConfig()?.apiKey).toBe(KEY);
  });

  it("never renders the raw key back into the DOM after save", async () => {
    const { view } = renderPanel({ kind: "rejected" });
    fillAndSave();
    await waitFor(() => { expect(screen.getByRole("alert")).toBeTruthy(); });
    expect(view.container.innerHTML).not.toContain(KEY);
    expect(screen.getByLabelText<HTMLInputElement>(dict.byok.apiKeyLabel).value).toBe("");
  });

  it("shows the masked summary instead of the credential", async () => {
    renderPanel({ kind: "ok", vision: true, definitive: true });
    fillAndSave();
    await waitFor(() => { expect(screen.getByText(dict.byok.maskedSummary)).toBeTruthy(); });
  });
});

describe("ByokSettings — probe failure taxonomy copy", () => {
  it("maps the collapsed unreachable code to its helper copy", async () => {
    renderPanel({ kind: "unreachable" });
    fillAndSave();
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(dict.byok.errorUnreachable);
    });
  });

  it("maps egress_blocked to the safety refusal copy", async () => {
    renderPanel({ kind: "invalid", code: "egress_blocked" });
    fillAndSave();
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(dict.byok.errorEgressBlocked);
    });
  });

  it("maps a lapsed-auth rejection to the requires-login copy", async () => {
    renderPanel({ kind: "requires_login" });
    fillAndSave();
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(dict.byok.errorRequiresLogin);
    });
  });
});

describe("ByokSettings — non-definitive probe never persists vision (#479 P2-1)", () => {
  it("keeps the stored flag in the unprobed null state and renders no badge", async () => {
    renderPanel({ kind: "ok", vision: false, definitive: false });
    fillAndSave();
    await waitFor(() => { expect(screen.queryByRole("status")).toBeNull(); });
    expect(getByokVisionSupported()).toBeNull();
    expect(screen.queryByText(dict.byok.visionBadge)).toBeNull();
  });
});

describe("ByokSettings — clear (T6-AC3 lockstep)", () => {
  it("drops the credential, the vision flag, and the badge together", async () => {
    renderPanel({ kind: "ok", vision: true, definitive: true });
    fillAndSave();
    await waitFor(() => { expect(screen.getByText(dict.byok.visionBadge)).toBeTruthy(); });
    fireEvent.click(screen.getByRole("button", { name: dict.byok.clear }));
    expect(getByokConfig()).toBeNull();
    expect(getByokVisionSupported()).toBeNull();
    expect(screen.queryByText(dict.byok.visionBadge)).toBeNull();
  });
});
