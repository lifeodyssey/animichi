/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAutoSend } from "../../../src/features/chat/use-auto-send";

type Props = Readonly<{ query?: string; enabled: boolean; session?: string }>;

function renderAutoSend(initial: Props) {
  const send = vi.fn();
  const view = renderHook(
    (props: Props) => {
      useAutoSend({ query: props.query, enabled: props.enabled, send, sessionId: props.session });
    },
    { initialProps: initial },
  );
  return { send, rerender: view.rerender };
}

describe("useAutoSend", () => {
  it("fires the query exactly once across re-renders", () => {
    const { send, rerender } = renderAutoSend({ query: "A", enabled: true });
    rerender({ query: "A", enabled: true });
    expect(send.mock.calls).toEqual([["A"]]);
  });

  it("fires again when the query changes on the same mounted route", () => {
    const { send, rerender } = renderAutoSend({ query: "A", enabled: true });
    rerender({ query: "B", enabled: true });
    expect(send.mock.calls).toEqual([["A"], ["B"]]);
  });

  it("treats the same query in a different session as a fresh send", () => {
    const { send, rerender } = renderAutoSend({ query: "A", enabled: true, session: "s-1" });
    rerender({ query: "A", enabled: true, session: "s-2" });
    expect(send.mock.calls).toEqual([["A"], ["A"]]);
  });

  it("does not fire while disabled and fires once enabled", () => {
    const { send, rerender } = renderAutoSend({ query: "A", enabled: false });
    expect(send).not.toHaveBeenCalled();
    rerender({ query: "A", enabled: true });
    expect(send.mock.calls).toEqual([["A"]]);
  });
});
