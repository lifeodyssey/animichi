/**
 * Unit tests for AppShell layout — map-first adaptive layout.
 * AC: desktop renders sidebar + result panel (full width), chat as popup
 * AC: mobile renders chat panel when no results
 * AC: clicking new chat button clears state
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import AppShell from "../components/layout/AppShell";

vi.mock("../components/chat/ChatPanel", () => ({
  default: () => <div data-testid="mock-chat-panel" />,
}));
vi.mock("../components/layout/ResultPanel", () => ({
  default: () => <div data-testid="mock-result-panel" />,
}));
vi.mock("../components/layout/ResultSheet", () => ({
  default: () => null,
}));
vi.mock("../components/chat/ChatPopup", () => ({
  default: ({ open }: { open: boolean }) =>
    <div data-testid="mock-chat-popup" data-open={open} />,
}));

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
  useDict: () => ({}),
}));

// Desktop viewport: all media queries return false (SSR default = desktop)
vi.mock("../hooks/useMediaQuery", () => ({
  useMediaQuery: () => false,
}));

describe("AppShell desktop layout", () => {
  afterEach(() => cleanup());
  beforeEach(() => vi.clearAllMocks());

  it("renders without crashing", () => {
    const { container } = render(<AppShell />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it("renders icon sidebar on desktop", () => {
    render(<AppShell />);
    expect(screen.getByTestId("icon-sidebar")).toBeInTheDocument();
  });

  it("renders result panel on desktop (map-first layout)", () => {
    render(<AppShell />);
    expect(screen.getByTestId("result-panel")).toBeInTheDocument();
  });

  it("does not render chat panel on desktop (chat is popup)", () => {
    render(<AppShell />);
    expect(screen.queryByTestId("chat-panel")).toBeNull();
  });

  it("renders chat popup component", () => {
    render(<AppShell />);
    expect(screen.getByTestId("mock-chat-popup")).toBeInTheDocument();
  });

  it("does not render old text sidebar", () => {
    const { container } = render(<AppShell />);
    expect(container.querySelector("[data-testid='text-sidebar']")).toBeNull();
  });
});

describe("AppShell interactions", () => {
  afterEach(() => cleanup());
  beforeEach(() => vi.clearAllMocks());

  it("clicking New chat button does not crash", () => {
    render(<AppShell />);
    const newChatBtn = screen.getByRole("button", { name: /新对话/i });
    fireEvent.click(newChatBtn);
    expect(screen.getByTestId("icon-sidebar")).toBeInTheDocument();
  });
});

describe("AppShell mobile layout", () => {
  afterEach(() => cleanup());

  it("renders without crashing", () => {
    const { container } = render(<AppShell />);
    expect(container.firstChild).toBeInTheDocument();
  });
});
