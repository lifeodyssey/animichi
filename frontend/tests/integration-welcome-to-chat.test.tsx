/**
 * Integration test: Welcome screen to chat transition.
 *
 * Tests the multi-component flow:
 * - ChatPanel renders WelcomeScreen when messages are empty
 * - User types in the WelcomeScreen input and submits
 * - Clicking a chip fills the input instead of sending
 *
 * Mocks: i18n-context, detectLocale
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatPanel from "@/components/chat/ChatPanel";
import { LocaleProvider } from "@/lib/i18n-context";
import type { UIMessage } from "ai";
import type { Dict } from "@/lib/i18n";
import defaultDict from "@/lib/dictionaries/ja.json";

const jaFull = defaultDict as unknown as Dict;

// Force ja locale in tests — jsdom navigator.languages defaults to ["en-US"]
vi.mock("@/lib/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/i18n")>();
  return { ...actual, detectLocale: () => "ja" as const };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderChatPanel(
  messages: UIMessage[],
  onSend = vi.fn(),
) {
  return {
    onSend,
    ...render(
      <LocaleProvider>
        <ChatPanel
          messages={messages}
          sending={false}
          activeMessageId={null}
          dict={jaFull}
          locale="ja"
          onSend={onSend}
          onActivate={vi.fn()}
        />
      </LocaleProvider>,
    ),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Integration: Welcome screen to chat transition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows WelcomeScreen when messages array is empty", () => {
    renderChatPanel([]);

    // Tagline is now the heading
    expect(
      screen.getByText("アニメの舞台を探して、巡礼ルートを作ろう"),
    ).toBeInTheDocument();
  });

  it("WelcomeScreen has a text input for typing queries", () => {
    renderChatPanel([]);

    const input = screen.getByPlaceholderText(
      /アニメ名を入力/,
    );
    expect(input).toBeInTheDocument();
  });

  it("typing and pressing Enter in WelcomeScreen calls onSend", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    renderChatPanel([], onSend);

    const input = screen.getByPlaceholderText(
      /アニメ名を入力/,
    );

    await user.type(input, "君の名は の聖地");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("君の名は の聖地", null);
    });
  });

  it("typing and clicking the send button calls onSend", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    renderChatPanel([], onSend);

    const input = screen.getByPlaceholderText(
      /アニメ名を入力/,
    );

    await user.type(input, "響け！ユーフォニアム");

    const sendBtn = screen.getByRole("button", { name: defaultDict.chat.send });
    await user.click(sendBtn);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("響け！ユーフォニアム", null);
    });
  });

  it("clicking a suggestion chip fills the input instead of sending", async () => {
    const user = userEvent.setup();
    renderChatPanel([]);

    const searchChip = screen.getByText(jaFull.welcome_screen.action_search);
    await user.click(searchChip);

    // Chip fills the WelcomeScreen input
    const input = screen.getByPlaceholderText(/アニメ名を入力/);
    expect(input).toHaveValue("君の名は の聖地を教えて");
  });

  it("does not submit when input is empty", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    renderChatPanel([], onSend);

    const input = screen.getByPlaceholderText(
      /アニメ名を入力/,
    );

    await user.click(input);
    await user.keyboard("{Enter}");

    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not show WelcomeScreen when messages are present", () => {
    const messages: UIMessage[] = [
      {
        id: "m1",
        role: "user",
        parts: [{ type: "text", text: "テストメッセージ" }],
      },
    ];
    renderChatPanel(messages);

    // Tagline (used as heading in welcome) should not be present
    expect(screen.queryByText(jaFull.welcome_screen.tagline)).not.toBeInTheDocument();
    expect(screen.getByText("テストメッセージ")).toBeInTheDocument();
  });
});
