/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { candidatePickBody } from "../../../src/features/chat/selection/candidate-pick";
import { useClarifyPick, useClarifyPickState } from "../../../src/features/chat/selection/use-clarify-pick";
import type { ChatSession } from "../../../src/features/chat/use-chat-session";

const PICK = { candidateId: "115908", label: "凉宫春日的忧郁(涼宮ハルヒの憂鬱)", clarificationId: 4 };

describe("candidatePickBody", () => {
  it("wires the id and pending revision into the contract shape", () => {
    expect(candidatePickBody(PICK)).toEqual({ selected_candidate_ids: ["115908"], clarification_id: 4 });
  });

  it("sends an explicit null when no clarification revision is pending", () => {
    expect(candidatePickBody({ ...PICK, clarificationId: undefined })).toEqual({
      selected_candidate_ids: ["115908"],
      clarification_id: null,
    });
  });
});

type ChatStub = Readonly<{
  sendCandidatePick: ReturnType<typeof vi.fn>;
  resendCandidatePick: ReturnType<typeof vi.fn>;
  status: string;
  error: Error | undefined;
}>;

function chatStub(status: string, error?: Error): ChatStub {
  return { sendCandidatePick: vi.fn(), resendCandidatePick: vi.fn(), status, error };
}

function renderPickTurn(initial: ChatStub) {
  return renderHook(({ chat }: { chat: ChatStub }) => useClarifyPickState(chat as unknown as ChatSession), {
    initialProps: { chat: initial },
  });
}

describe("useClarifyPickState", () => {
  it("fires the structured pick and settles back to idle on success", () => {
    const chat = chatStub("ready");
    const { result, rerender } = renderPickTurn(chat);
    act(() => { result.current.pick(PICK); });
    expect(chat.sendCandidatePick).toHaveBeenCalledExactlyOnceWith(PICK);
    expect(result.current.status).toBe("busy");
    rerender({ chat: { ...chat, status: "streaming" } });
    rerender({ chat: { ...chat, status: "ready" } });
    expect(result.current.status).toBe("idle");
    expect(result.current.lastPick).toEqual(PICK);
  });

  it("reports failed on a settled error so the card can re-arm", () => {
    const chat = chatStub("ready");
    const { result, rerender } = renderPickTurn(chat);
    act(() => { result.current.pick(PICK); });
    rerender({ chat: { ...chat, status: "submitted" } });
    rerender({ chat: { ...chat, status: "error", error: new Error("409") } });
    expect(result.current.status).toBe("failed");
  });

  it("refuses to pick while another turn is in flight (shared status gate)", () => {
    const chat = chatStub("streaming");
    const { result } = renderPickTurn(chat);
    expect(result.current.sendable).toBe(false);
    act(() => { result.current.pick(PICK); });
    expect(chat.sendCandidatePick).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

});

describe("useClarifyPickState resend", () => {
  it("resends the last failed pick through the same-key resend channel", () => {
    const chat = chatStub("ready");
    const { result, rerender } = renderPickTurn(chat);
    act(() => { result.current.pick(PICK); });
    rerender({ chat: { ...chat, status: "submitted" } });
    rerender({ chat: { ...chat, status: "error", error: new Error("409") } });
    act(() => { result.current.resend(); });
    expect(chat.resendCandidatePick).toHaveBeenCalledExactlyOnceWith(PICK);
    expect(result.current.status).toBe("busy");
  });

  it("refuses to resend while another turn is in flight", () => {
    const chat = chatStub("ready");
    const { result, rerender } = renderPickTurn(chat);
    act(() => { result.current.pick(PICK); });
    rerender({ chat: { ...chat, status: "streaming" } });
    act(() => { result.current.resend(); });
    expect(chat.resendCandidatePick).not.toHaveBeenCalled();
  });

  it("resend without a stored pick is inert", () => {
    const chat = chatStub("ready");
    const { result } = renderPickTurn(chat);
    act(() => { result.current.resend(); });
    expect(chat.resendCandidatePick).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });
});

describe("useClarifyPick outside a provider", () => {
  it("degrades to the disabled channel whose actions are inert", () => {
    const { result } = renderHook(() => useClarifyPick());
    expect(result.current.enabled).toBe(false);
    expect(result.current.sendable).toBe(true);
    act(() => { result.current.pick(PICK); });
    act(() => { result.current.resend(); });
    expect(result.current.status).toBe("idle");
    expect(result.current.lastPick).toBeUndefined();
  });
});
