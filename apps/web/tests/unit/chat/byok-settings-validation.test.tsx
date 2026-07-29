/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ByokSettings } from "../../../src/features/chat/components/ByokSettings";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { BYOK_DEFAULT_MODEL, getByokConfig } from "../../../src/lib/byok/byokStorage";

const dict = chatDictFor("ja");
const probe = vi.fn().mockResolvedValue({ kind: "ok", vision: false });

function renderPanel(): void {
  render(<ByokSettings dict={dict} auth="authenticated" baseUrl="http://agent.test" probe={probe} />);
}

function pickFamily(label: string): void {
  fireEvent.click(screen.getByLabelText(label));
}

function save(): void {
  fireEvent.click(screen.getByRole("button", { name: dict.byok.save }));
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe("ByokSettings — model field (T6-AC4, OQ-1)", () => {
  it("blocks an openai-compatible save with no model behind an inline message", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText(dict.byok.apiKeyLabel), { target: { value: "sk-test-1" } });
    save();
    expect(screen.getByRole("alert").textContent).toBe(dict.byok.modelRequired);
    expect(getByokConfig()).toBeNull();
    expect(probe).not.toHaveBeenCalled();
  });

  it("pre-fills the named Anthropic default while keeping the field editable", () => {
    renderPanel();
    pickFamily(dict.byok.familyAnthropic);
    const model = screen.getByLabelText<HTMLInputElement>(dict.byok.modelLabel);
    expect(model.value).toBe(BYOK_DEFAULT_MODEL.anthropic);
    fireEvent.change(model, { target: { value: "claude-custom" } });
    expect(model.value).toBe("claude-custom");
  });

  it("pre-fills the named Gemini default on family switch", () => {
    renderPanel();
    pickFamily(dict.byok.familyGemini);
    expect(screen.getByLabelText<HTMLInputElement>(dict.byok.modelLabel).value)
      .toBe(BYOK_DEFAULT_MODEL.gemini);
  });

  it("keeps a hand-typed model name across a family switch", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText(dict.byok.modelLabel), { target: { value: "my-vllm" } });
    pickFamily(dict.byok.familyAnthropic);
    expect(screen.getByLabelText<HTMLInputElement>(dict.byok.modelLabel).value).toBe("my-vllm");
  });
});

describe("ByokSettings — field validation inline errors", () => {
  it("blocks a save with no key behind the key-required message", () => {
    renderPanel();
    save();
    expect(screen.getByRole("alert").textContent).toBe(dict.byok.apiKeyRequired);
  });

  it("clears the inline error as soon as a field changes", () => {
    renderPanel();
    save();
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(dict.byok.apiKeyLabel), { target: { value: "sk-x" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the base_url field for openai-compatible only", () => {
    renderPanel();
    expect(screen.getByLabelText(dict.byok.baseUrlLabel)).toBeTruthy();
    pickFamily(dict.byok.familyAnthropic);
    expect(screen.queryByLabelText(dict.byok.baseUrlLabel)).toBeNull();
  });

  it("masks the key field as a password input", () => {
    renderPanel();
    expect(screen.getByLabelText<HTMLInputElement>(dict.byok.apiKeyLabel).type).toBe("password");
  });
});
