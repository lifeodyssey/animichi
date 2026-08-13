/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ErrorBanner } from "../../../src/features/chat/components/ErrorBanner";
import { chatDictFor } from "../../../src/features/chat/i18n";

afterEach(cleanup);

const ja = chatDictFor("ja");

/**
 * WCAG 4.1.3 (was 4.1.2)/ARIA live regions: async updates must be announced
 * to assistive tech without stealing focus. Banner errors ride role=alert.
 */
describe("live regions: chat async updates", () => {
  it("announces banner errors immediately (role=alert)", () => {
    render(<ErrorBanner dict={ja} onRetry={() => undefined} message="接続に失敗しました" />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("接続に失敗しました");
    expect(screen.getByRole("button", { name: ja.retry })).toBeTruthy();
  });

  it("exposes the retry banner under the assertive alert role", () => {
    const { container } = render(<ErrorBanner dict={ja} onRetry={() => undefined} />);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});
