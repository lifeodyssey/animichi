/**
 * D4 AC tests — History drawer + Saved pilgrimages (states 14/15)
 *
 * AC coverage:
 * - Happy: history drawer lists recent sessions as cards; selecting one calls hydrate -> integration
 * - Null/empty: empty history shows empty state (not blank panel) -> unit
 * - Error: corrupt/partial saved entry renders safe card (no crash) and is skippable -> unit
 * - i18n: drawer/saved labels localized -> unit
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ConversationList,
  SafeConversationCard,
  EmptyConversations,
} from "@/components/layout/ConversationListShared";
import ConversationDrawer from "@/components/layout/ConversationDrawer";
import type { ConversationRecord } from "@/lib/types";
import defaultDict from "@/lib/dictionaries/ja.json";

vi.mock("@/lib/i18n-context", () => ({
  useDict: () => defaultDict,
}));

const makeRecord = (override: Partial<ConversationRecord> = {}): ConversationRecord => ({
  session_id: "sess-100",
  title: "響け！ユーフォニアム 宇治巡礼",
  first_query: "宇治の聖地を探して",
  created_at: "2026-05-01T00:00:00.000Z",
  updated_at: "2026-05-01T12:00:00.000Z",
  ...override,
});

// ── Happy path ─────────────────────────────────────────────────────────────

describe("D4 Happy: history drawer lists sessions as cards and hydrates on select", () => {
  it("renders session titles as clickable cards in the drawer", () => {
    const records = [
      makeRecord({ session_id: "a1", title: "宇治聖地巡礼" }),
      makeRecord({ session_id: "a2", title: "新宿巡礼ルート", first_query: "新宿の聖地" }),
    ];

    render(
      <ConversationDrawer
        open={true}
        onClose={vi.fn()}
        conversations={records}
        activeSessionId={null}
        onSelectConversation={vi.fn()}
        onNewChat={vi.fn()}
      />,
    );

    expect(screen.getByText("宇治聖地巡礼")).toBeInTheDocument();
    expect(screen.getByText("新宿巡礼ルート")).toBeInTheDocument();
  });

  it("calls onSelectConversation (hydrate) when a session card is clicked", () => {
    const onSelectConversation = vi.fn();
    const records = [makeRecord({ session_id: "hydrate-1", title: "水面の巡礼" })];

    render(
      <ConversationList
        conversations={records}
        activeSessionId={null}
        onSelectConversation={onSelectConversation}
      />,
    );

    fireEvent.click(screen.getByTestId("conversation-item-hydrate-1"));
    expect(onSelectConversation).toHaveBeenCalledWith("hydrate-1");
  });
});

// ── Null / empty ────────────────────────────────────────────────────────────

describe("D4 Null/empty: empty history shows empty state not blank panel", () => {
  it("renders EmptyConversations with a visible message when list is empty", () => {
    render(<EmptyConversations />);
    expect(screen.getByTestId("conversation-drawer-empty")).toBeInTheDocument();
    expect(screen.getByTestId("conversation-drawer-empty")).not.toBeEmptyDOMElement();
  });

  it("ConversationList renders empty state when conversations array is empty", () => {
    render(
      <ConversationList
        conversations={[]}
        activeSessionId={null}
        onSelectConversation={vi.fn()}
      />,
    );
    expect(screen.getByTestId("conversation-drawer-empty")).toBeInTheDocument();
  });
});

// ── Error path ──────────────────────────────────────────────────────────────

describe("D4 Error: corrupt/partial saved entry renders safe card and is skippable", () => {
  it("SafeConversationCard renders without crash for a valid record", () => {
    const record = makeRecord({ title: "テスト巡礼" });
    expect(() =>
      render(
        <SafeConversationCard
          record={record}
          isActive={false}
          onSelect={vi.fn()}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByText("テスト巡礼")).toBeInTheDocument();
  });

  it("SafeConversationCard falls back to first_query when title is null", () => {
    const record = makeRecord({ title: null, first_query: "近くの聖地を探して" });
    render(
      <SafeConversationCard
        record={record}
        isActive={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText(/近くの聖地/)).toBeInTheDocument();
  });

  it("ConversationList skips corrupt entries (empty session_id) without crashing", () => {
    const corrupt = { ...makeRecord(), session_id: "" } as ConversationRecord;
    const valid = makeRecord({ session_id: "valid-1", title: "有効な巡礼" });
    expect(() =>
      render(
        <ConversationList
          conversations={[corrupt, valid]}
          activeSessionId={null}
          onSelectConversation={vi.fn()}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByText("有効な巡礼")).toBeInTheDocument();
  });
});

// ── i18n ─────────────────────────────────────────────────────────────────────

describe("D4 i18n: drawer/saved labels localized", () => {
  it("ConversationDrawer renders title from dictionary", () => {
    render(
      <ConversationDrawer
        open={true}
        onClose={vi.fn()}
        conversations={[]}
        activeSessionId={null}
        onSelectConversation={vi.fn()}
        onNewChat={vi.fn()}
      />,
    );
    expect(screen.getByText(defaultDict.drawer.title)).toBeInTheDocument();
  });

  it("ConversationDrawer renders new_chat button from dictionary", () => {
    render(
      <ConversationDrawer
        open={true}
        onClose={vi.fn()}
        conversations={[]}
        activeSessionId={null}
        onSelectConversation={vi.fn()}
        onNewChat={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: new RegExp(defaultDict.drawer.new_chat.replace(/[+]/g, "\\+"), "i") }),
    ).toBeInTheDocument();
  });

  it("EmptyConversations renders localized empty message", () => {
    render(<EmptyConversations />);
    expect(screen.getByText(defaultDict.drawer.empty)).toBeInTheDocument();
  });

  it("ConversationList renders recent label from dictionary", () => {
    const records = [makeRecord({ session_id: "r1", title: "巡礼記録" })];
    render(
      <ConversationList
        conversations={records}
        activeSessionId={null}
        onSelectConversation={vi.fn()}
      />,
    );
    expect(screen.getByText(defaultDict.drawer.recent)).toBeInTheDocument();
  });
});
