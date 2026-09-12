/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { ChatActionsProvider } from "../../../src/features/chat/ChatActions";
import type { ChatActions } from "../../../src/features/chat/ChatActions";
import { EnvelopeFallback } from "../../../src/features/chat/components/ErrorStates/EnvelopeFallback";
import { chatDictFor } from "../../../src/features/chat/i18n";

afterEach(cleanup);
const dict = chatDictFor("zh"), copy = dict.errorStates;

function Recovery({ actions, state = "D1" }: Readonly<{ actions: ChatActions; state?: "D1" | "D6" }>) {
  return <ChatActionsProvider actions={actions}><EnvelopeFallback state={state} dict={dict} /></ChatActionsProvider>;
}

function enterClue(value: string) {
  const field = screen.getByRole<HTMLInputElement>("textbox");
  fireEvent.change(field, { target: { value } });
  const form = field.closest("form");
  assert(form);
  return form;
}

describe("clue submission boundaries", () => {
  it("rejects blank input and duplicate native form submissions", () => {
    const actions = { send: vi.fn(), regenerate: vi.fn() };
    render(<Recovery actions={actions} />);
    fireEvent.submit(enterClue("   "));
    expect(actions.send).not.toHaveBeenCalled();
    const form = enterClue("  两个高中生交换了身体  ");
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(actions.send).toHaveBeenCalledExactlyOnceWith("两个高中生交换了身体");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: copy.d1Submit }).disabled).toBe(true);
  });

  it("allows corrected clues after a previous submission", () => {
    const actions = { send: vi.fn(), regenerate: vi.fn() };
    render(<Recovery actions={actions} />);
    fireEvent.submit(enterClue("君の名は"));
    const corrected = enterClue("想去东京的取景地");
    expect(screen.getByRole("status").textContent).toBe("");
    fireEvent.submit(corrected);
    expect(actions.send.mock.calls).toEqual([["君の名は"], ["想去东京的取景地"]]);
  });
});

describe("parent busy and quota state", () => {
  it("retains an unsent clue while locked and sends it once after unlocking", () => {
    const actions = { send: vi.fn(), regenerate: vi.fn() };
    const view = render(<Recovery actions={actions} />);
    const form = enterClue("吹响吧！上低音号");
    view.rerender(<Recovery actions={{ ...actions, disabled: true }} />);
    fireEvent.submit(form);
    expect(actions.send).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("");
    expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe("吹响吧！上低音号");
    view.rerender(<Recovery actions={actions} />);
    fireEvent.submit(form);
    expect(actions.send).toHaveBeenCalledExactlyOnceWith("吹响吧！上低音号");
  });

  it("locks retry during an active turn without starting a new message", () => {
    const actions = { send: vi.fn(), regenerate: vi.fn() };
    const view = render(<Recovery state="D6" actions={{ ...actions, disabled: true }} />);
    fireEvent.click(screen.getByRole("button", { name: copy.d6Retry }));
    expect(actions.regenerate).not.toHaveBeenCalled();
    view.rerender(<Recovery state="D6" actions={actions} />);
    fireEvent.click(screen.getByRole("button", { name: copy.d6Retry }));
    expect(actions.regenerate).toHaveBeenCalledTimes(1);
    expect(actions.send).not.toHaveBeenCalled();
  });
});
