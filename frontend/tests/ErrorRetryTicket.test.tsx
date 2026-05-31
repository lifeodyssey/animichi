/**
 * ErrorRetryTicket unit tests — Task C4
 *
 * AC coverage:
 * - Happy: renders message + Retry + Edit-query actions -> unit
 * - Error: Retry action invokes the provided retry callback exactly once (no double-fire) -> unit
 * - i18n: all copy localized -> unit
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorRetryTicket } from "@/components/generative/ErrorRetryTicket";
import defaultDict from "@/lib/dictionaries/ja.json";

vi.mock("@/lib/i18n-context", () => ({
  useDict: () => defaultDict,
}));

describe("ErrorRetryTicket — happy path", () => {
  it("renders the heading from dict", () => {
    render(<ErrorRetryTicket onRetry={vi.fn()} />);
    expect(
      screen.getByText(defaultDict.error_retry_ticket.heading),
    ).toBeInTheDocument();
  });

  it("renders the body message from dict", () => {
    render(<ErrorRetryTicket onRetry={vi.fn()} />);
    expect(
      screen.getByText(defaultDict.error_retry_ticket.body),
    ).toBeInTheDocument();
  });

  it("renders a Retry button", () => {
    render(<ErrorRetryTicket onRetry={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: defaultDict.error_retry_ticket.retry }),
    ).toBeInTheDocument();
  });

  it("renders an Edit-query button", () => {
    render(<ErrorRetryTicket onRetry={vi.fn()} />);
    expect(
      screen.getByRole("button", {
        name: defaultDict.error_retry_ticket.edit_query,
      }),
    ).toBeInTheDocument();
  });

  it("renders a torii stamp landmark", () => {
    const { container } = render(<ErrorRetryTicket onRetry={vi.fn()} />);
    expect(
      container.querySelector("[data-testid='torii-stamp']"),
    ).toBeInTheDocument();
  });
});

describe("ErrorRetryTicket — error path (Retry callback)", () => {
  it("invokes onRetry exactly once when Retry button is clicked", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ErrorRetryTicket onRetry={onRetry} />);
    await user.click(
      screen.getByRole("button", { name: defaultDict.error_retry_ticket.retry }),
    );
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("does not double-fire on rapid clicks (disabled after first)", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ErrorRetryTicket onRetry={onRetry} />);
    const btn = screen.getByRole("button", {
      name: defaultDict.error_retry_ticket.retry,
    });
    await user.dblClick(btn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("invokes onEditQuery when Edit-query button is clicked", async () => {
    const user = userEvent.setup();
    const onEditQuery = vi.fn();
    render(<ErrorRetryTicket onRetry={vi.fn()} onEditQuery={onEditQuery} />);
    await user.click(
      screen.getByRole("button", {
        name: defaultDict.error_retry_ticket.edit_query,
      }),
    );
    expect(onEditQuery).toHaveBeenCalledTimes(1);
  });
});

describe("ErrorRetryTicket — i18n", () => {
  it("renders all four copy strings from dictionary", () => {
    render(<ErrorRetryTicket onRetry={vi.fn()} />);
    const t = defaultDict.error_retry_ticket;
    expect(screen.getByText(t.heading)).toBeInTheDocument();
    expect(screen.getByText(t.body)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.retry })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t.edit_query }),
    ).toBeInTheDocument();
  });
});
