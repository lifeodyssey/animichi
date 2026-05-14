/**
 * AC: After first message, WelcomeScreen replaced by message list.
 * -> unit
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatPanel from "@/components/chat/ChatPanel";
import { LocaleProvider } from "@/lib/i18n-context";
import type { UIMessage } from "ai";
import type { Dict } from "@/lib/i18n";
import jaDict from "@/lib/dictionaries/ja.json";

const jaFull = jaDict as unknown as Dict;

function makeMessage(id: string, role: "user" | "assistant", text: string): UIMessage {
  return { id, role, parts: [{ type: "text", text }] };
}

function renderChatPanel(
  messages: UIMessage[],
  onSend = vi.fn(),
) {
  return render(
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
  );
}

describe("ChatPanel", () => {
  it("renders WelcomeScreen when messages are empty", () => {
    renderChatPanel([]);
    // Tagline is now the heading in WelcomeScreen
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("renders message text when messages are non-empty", () => {
    renderChatPanel([makeMessage("m1", "user", "君の名は の聖地を教えて")]);
    expect(screen.getByText("君の名は の聖地を教えて")).toBeInTheDocument();
  });

  it("does not render WelcomeScreen when messages are non-empty", () => {
    renderChatPanel([makeMessage("m1", "user", "テストメッセージ")]);
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });

  describe("typing and sending a message", () => {
    it("calls onSend with the typed text when Enter is pressed", async () => {
      const onSend = vi.fn();
      renderChatPanel([], onSend);
      const textarea = screen.getByRole("textbox");
      await userEvent.type(textarea, "ゆるキャン の聖地");
      await act(async () => {
        await userEvent.keyboard("{Enter}");
      });
      await waitFor(() => {
        expect(onSend).toHaveBeenCalledWith("ゆるキャン の聖地", null);
      });
    });
  });

  // geolocation coords wiring tests removed — location button was removed during design migration
});
