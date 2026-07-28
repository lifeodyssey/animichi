/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectionTray } from "../../../src/features/chat/components/SelectionTray";
import type { RecomputeStatus } from "../../../src/features/chat/components/SelectionTray";
import { SearchResult } from "../../../src/features/chat/components/SearchResult";
import type { AttachBasemap } from "../../../src/features/chat/components/SearchMap";
import {
  SpotSelectionProvider,
  useSpotSelectionState,
} from "../../../src/features/chat/selection/useSpotSelection";
import { chatDictFor } from "../../../src/features/chat/i18n";
import type { Locale } from "../../../src/i18n/locales";
import { toSearchSpots } from "../../../src/lib/chat/spotClusters";

afterEach(cleanup);

const attachReady: AttachBasemap = ({ onStatus }) => {
  onStatus("ready");
  return () => undefined;
};

function spotRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${String(i)}`,
    name: `spot-${String(i)}`,
    lat: 34.89 + i * 0.001,
    lng: 135.8,
  }));
}

type HarnessProps = Readonly<{
  locale?: Locale;
  status?: RecomputeStatus;
  lastSentIds?: readonly string[];
  onRecompute?: (ids: readonly string[]) => void;
}>;

function Harness({ locale = "ja", status = "idle", lastSentIds, onRecompute = () => undefined }: HarnessProps) {
  const selection = useSpotSelectionState();
  const dict = chatDictFor(locale);
  return (
    <SpotSelectionProvider selection={selection}>
      <SearchResult spots={toSearchSpots(spotRows(3))} dict={dict} attach={attachReady} />
      <SelectionTray dict={dict} status={status} lastSentIds={lastSentIds} onRecompute={onRecompute} />
    </SpotSelectionProvider>
  );
}

function tray(): Element | null {
  return document.querySelector(".chat-selection-tray");
}

function tick(name: string) {
  fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(name, "u") }));
}

describe("AC null/empty: the tray follows the live selection", () => {
  it("is absent from the DOM with zero checkboxes ticked", () => {
    render(<Harness />);
    expect(tray()).toBeNull();
  });

  it("appears on the first tick and leaves when the last selection is unticked", () => {
    render(<Harness />);
    tick("spot-1");
    expect(tray()).not.toBeNull();
    tick("spot-1");
    expect(tray()).toBeNull();
  });

  it("keeps the checkboxes controlled: ticking marks exactly that card checked", () => {
    render(<Harness />);
    tick("spot-1");
    const boxes = screen.getAllByRole<HTMLInputElement>("checkbox");
    expect(boxes.map((box) => box.checked)).toContain(true);
    expect(boxes.filter((box) => box.checked)).toHaveLength(1);
  });
});

describe("AC i18n: count copy, action label and retry label render per locale", () => {
  const cases: readonly [Locale, string, string, string][] = [
    ["ja", "2件選択中", "ルートを組み直す", "もう一度ためす"],
    ["zh", "已选 2 处", "重新规划路线", "再试一次"],
    ["en", "2 selected", "Rebuild the route", "Try again"],
  ];

  for (const [locale, count, action, retry] of cases) {
    it(`interpolates the count and labels the actions in ${locale}`, () => {
      render(<Harness locale={locale} />);
      tick("spot-0");
      tick("spot-1");
      expect(screen.getByText(count)).toBeTruthy();
      expect(screen.getByRole("button", { name: action })).toBeTruthy();
      cleanup();
      render(<Harness locale={locale} status="failed" />);
      tick("spot-0");
      tick("spot-1");
      expect(screen.getByRole("button", { name: retry })).toBeTruthy();
    });
  }
});

describe("AC error path: a failed recompute retries on the tray and keeps the selection", () => {
  it("shows the failure copy and fires the retry with the preserved selection", () => {
    const onRecompute = vi.fn();
    render(<Harness status="failed" onRecompute={onRecompute} />);
    tick("spot-0");
    tick("spot-2");
    fireEvent.click(screen.getByRole("button", { name: chatDictFor("ja").search.trayRetry }));
    expect(onRecompute).toHaveBeenCalledExactlyOnceWith(["p0", "p2"]);
    const checked = screen.getAllByRole<HTMLInputElement>("checkbox").filter((box) => box.checked);
    expect(checked).toHaveLength(2);
  });

  it("stays visible on failure even when the selection matches the last sent ids", () => {
    render(<Harness status="failed" lastSentIds={["p0"]} />);
    tick("spot-0");
    expect(tray()).not.toBeNull();
  });
});

describe("tray visibility vs. the recompute lifecycle", () => {
  it("hides while the recompute is in flight", () => {
    render(<Harness status="busy" />);
    tick("spot-0");
    expect(tray()).toBeNull();
  });

  it("hides after a successful recompute until the selection changes again", () => {
    render(<Harness lastSentIds={["p0", "p1"]} />);
    tick("spot-0");
    tick("spot-1");
    expect(tray()).toBeNull();
    tick("spot-2");
    expect(tray()).not.toBeNull();
  });
});
