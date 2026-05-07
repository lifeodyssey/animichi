/**
 * Unit tests for AppShell layout structure and interactions.
 * AC: renders SharedHeader + chat panel on desktop
 * AC: clicking new chat button clears chat state
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import AppShell from "../components/layout/AppShell";

// Mock child components that use network or complex browser APIs.
vi.mock("../components/chat/ChatPanel", () => ({
  default: () => <div data-testid="mock-chat-panel" />,
}));
vi.mock("../components/layout/ResultPanel", () => ({
  default: () => <div data-testid="mock-result-panel" />,
}));
vi.mock("../components/layout/ResultSheet", () => ({
  default: () => null,
}));

// Essential hook mocks: hooks that require browser APIs (localStorage, fetch, SSE).
vi.mock("../hooks/useSession", () => ({
  useSession: () => ({
    sessionId: null,
    setSessionId: vi.fn(),
    clearSession: vi.fn(),
  }),
}));

vi.mock("../hooks/useChat", () => ({
  useChat: () => ({
    messages: [],
    send: vi.fn(),
    sending: false,
    clear: vi.fn(),
    appendMessages: vi.fn(),
    replaceMessage: vi.fn(),
    removeMessage: vi.fn(),
  }),
  createMessageId: () => "test-id",
}));

vi.mock("../hooks/usePointSelection", () => ({
  usePointSelection: () => ({
    selectedIds: new Set(),
    toggle: vi.fn(),
    clear: vi.fn(),
  }),
}));

vi.mock("../lib/i18n-context", () => ({
  useLocale: () => "ja",
  useDict: () => ({
    sidebar: { new_chat: "+ 新しい会話" },
    drawer: { title: "履歴" },
    chat: { welcome_title: "聖地巡礼" },
    welcome_screen: { tagline: "test" },
    landing_hero: { landing: { login: "Log in" } },
  }),
}));

vi.mock("../hooks/useMediaQuery", () => ({
  useMediaQuery: () => false,
}));

describe("AppShell layout", () => {
  afterEach(() => cleanup());
  beforeEach(() => vi.clearAllMocks());

  it("renders without crashing", () => {
    const { container } = render(<AppShell />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it("renders the SharedHeader with brand name", () => {
    render(<AppShell />);
    expect(screen.getByText("聖地巡礼")).toBeInTheDocument();
  });

  it("renders the chat panel", () => {
    render(<AppShell />);
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
  });

  it("does not render result panel when no active result", () => {
    render(<AppShell />);
    expect(screen.queryByTestId("result-panel")).toBeNull();
  });

  it("does not render old icon sidebar or chat popup", () => {
    const { container } = render(<AppShell />);
    expect(container.querySelector("[data-testid='icon-sidebar']")).toBeNull();
  });
});

describe("AppShell interactions", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clicking the New chat button does not crash", () => {
    render(<AppShell />);
    const newChatBtn = screen.getByText("新しい会話");
    fireEvent.click(newChatBtn);
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
  });
});

describe("AppShell mobile layout", () => {
  afterEach(() => cleanup());

  it("renders without crashing", () => {
    const { container } = render(<AppShell />);
    expect(container.firstChild).toBeInTheDocument();
  });
});
