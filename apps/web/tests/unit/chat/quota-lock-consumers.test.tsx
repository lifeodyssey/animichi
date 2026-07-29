/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatActionsProvider } from "../../../src/features/chat/chat-actions";
import type { ChatActions } from "../../../src/features/chat/chat-actions";
import { DataPartCard } from "../../../src/features/chat/components/DataPartCard";
import { EnvelopeFallback } from "../../../src/features/chat/components/ErrorStates/EnvelopeFallback";
import { ShortRouteNotice } from "../../../src/features/chat/components/ErrorStates/ShortRouteNotice";
import { useLockedActions } from "../../../src/features/chat/quota-lock";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { mockChatActions } from "./_actions";

afterEach(cleanup);

const dict = chatDictFor("ja");

/**
 * `send`/`regenerate` reach the card tree through `ChatActionsProvider`, so a
 * composer-only lock leaks: every card chip below is a turn the exhausted
 * quota already refused. These are the representative leak sites.
 */
function LockedTree({ actions, children }: Readonly<{ actions: ChatActions; children: ReactElement }>) {
  return <ChatActionsProvider actions={useLockedActions(actions, true)}>{children}</ChatActionsProvider>;
}

function renderLocked(child: ReactElement): ChatActions {
  const actions = mockChatActions();
  render(<LockedTree actions={actions}>{child}</LockedTree>);
  return actions;
}

describe("D12 lock reaches every ChatActions consumer, not just the composer", () => {
  it("swallows the D3 short-route widening chip", () => {
    const actions = renderLocked(<ShortRouteNotice dict={dict} />);
    fireEvent.click(screen.getByRole("button", { name: dict.errorStates.d3Chip }));
    expect(actions.send).not.toHaveBeenCalled();
  });

  it("swallows the D1 suggestion chips", () => {
    const [chip] = dict.chips;
    const actions = renderLocked(<EnvelopeFallback state="D1" dict={dict} />);
    fireEvent.click(screen.getByRole("button", { name: chip }));
    expect(actions.send).not.toHaveBeenCalled();
  });

  it("swallows the D6 apology's regenerate", () => {
    const actions = renderLocked(<EnvelopeFallback state="D6" dict={dict} />);
    fireEvent.click(screen.getByRole("button", { name: dict.errorStates.d6Retry }));
    expect(actions.regenerate).not.toHaveBeenCalled();
  });

  it("swallows a clarify candidate pick", () => {
    const data = { candidates: [{ id: "1", title: "響け!ユーフォニアム" }] };
    const actions = renderLocked(<DataPartCard data={{ intent: "clarify", data }} dict={dict} />);
    fireEvent.click(screen.getByRole("button", { name: "響け!ユーフォニアム" }));
    expect(actions.send).not.toHaveBeenCalled();
  });
});

describe("the same consumers work normally when the quota is not spent", () => {
  it("sends the D3 chip through an unlocked provider", () => {
    const actions = mockChatActions();
    render(
      <ChatActionsProvider actions={actions}>
        <ShortRouteNotice dict={dict} />
      </ChatActionsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: dict.errorStates.d3Chip }));
    expect(actions.send).toHaveBeenCalledWith(dict.errorStates.d3Chip);
  });
});
