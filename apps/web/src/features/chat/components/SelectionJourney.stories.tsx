import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { attachProjectedBasemap, journeySpots } from "../../../../.storybook/chat-cards/fixtures";
import { selectedPlaceCount, selectionSummaryCopy } from "../selection-summary-copy";
import { selectedPlacesCopy } from "../selected-places-copy";
import { chatDictFor } from "../i18n";
import { SelectionJourney } from "./SelectionJourney";

const DOCS = "Composed fixture journey (issue #1641 slice 1): one selection scope keyed by stable place id behind real region bubbles, spot photo cards, map markers, the selection summary and the selected-place list. Every place, image and count is a repository fixture, not live catalog data; planning requests, persistence and page integration stay unwired.";

const meta = {
  title: "Chat/Journeys/DiscoveryToSelection",
  component: SelectionJourney,
  parameters: { layout: "centered", docs: { description: { component: DOCS } } },
  globals: { locale: "zh" },
  args: { spots: journeySpots, dict: chatDictFor("zh"), attach: attachProjectedBasemap, onContinue: fn() },
  argTypes: { dict: { control: false }, attach: { control: false } },
} satisfies Meta<typeof SelectionJourney>;
export default meta;
type Story = StoryObj<typeof meta>;

const LONG = "須賀神社 男坂（新宿区須賀町の長い石段）";

function copyFor(locale: "ja" | "zh" | "en") {
  const search = chatDictFor(locale).search;
  return { pick: search.select, photos: search.photoView, map: search.mapView, summary: selectionSummaryCopy(locale), list: selectedPlacesCopy(locale), one: selectedPlaceCount(locale, 1), two: selectedPlaceCount(locale, 2) };
}

async function openRegion(canvas: HTMLElement, city: string) {
  await userEvent.click(within(canvas).getByRole("button", { name: new RegExp(city) }));
}

async function pick(canvas: HTMLElement, name: string, label: string) {
  await userEvent.click(within(canvas).getByRole("checkbox", { name: `${label}: ${name}` }));
}

async function expectCount(canvas: HTMLElement, count: string) {
  await expect(within(canvas).getByRole("status")).toHaveTextContent(count);
}

/** Discovery → photo selection → map view → marker selection, with the count observable. */
async function walkToSelection(canvasElement: HTMLElement, locale: "ja" | "zh" | "en") {
  const copy = copyFor(locale);
  await openRegion(canvasElement, "新宿区");
  await pick(canvasElement, LONG, copy.pick);
  await expectCount(canvasElement, copy.one);
  await pickOnMap(canvasElement, copy);
  await expectCount(canvasElement, copy.two);
}

async function pickOnMap(canvasElement: HTMLElement, copy: ReturnType<typeof copyFor>) {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole("button", { name: copy.map }));
  await userEvent.click(canvas.getByRole("button", { name: "四ツ谷駅" }));
  await pick(canvasElement, "四ツ谷駅", copy.pick);
}

export const DesktopJourney: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await walkToSelection(canvasElement, "zh");
    await userEvent.click(canvas.getByRole("button", { name: "照片" }));
    await expect(canvas.getByText("四ツ谷駅").closest("li")).toHaveAttribute("data-selected", "true");
  },
};

export const MobileJourney: Story = {
  parameters: { chatViewport: "component-narrow" },
  play: async ({ canvasElement }) => { await walkToSelection(canvasElement, "zh"); },
};

export const JapaneseJourney: Story = {
  globals: { locale: "ja" },
  args: { dict: chatDictFor("ja") },
  play: async ({ canvasElement }) => { await walkToSelection(canvasElement, "ja"); },
};

export const EnglishJourney: Story = {
  globals: { locale: "en" },
  args: { dict: chatDictFor("en") },
  play: async ({ canvasElement }) => { await walkToSelection(canvasElement, "en"); },
};

export const ReviewList: Story = {
  play: async ({ canvasElement }) => {
    const copy = copyFor("zh");
    const canvas = within(canvasElement);
    await openRegion(canvasElement, "新宿区");
    await pick(canvasElement, LONG, copy.pick);
    await userEvent.click(canvas.getByRole("button", { name: copy.summary.review }));
    await expect(canvas.getByRole("heading", { name: copy.list.title })).toBeTruthy();
    await userEvent.click(canvas.getByRole("button", { name: `${copy.list.removePlace}: ${LONG}` }));
    await expectCount(canvasElement, copy.list.removed.replace("{name}", ""));
  },
};

export const PlanWithSelection: Story = {
  play: async ({ canvasElement, args }) => {
    const copy = copyFor("zh");
    const canvas = within(canvasElement);
    await openRegion(canvasElement, "新宿区");
    await pick(canvasElement, LONG, copy.pick);
    await pick(canvasElement, "四ツ谷駅", copy.pick);
    await userEvent.click(canvas.getByRole("button", { name: copy.summary.continue }));
    await expect(args.onContinue).toHaveBeenCalledWith(["suga", "yotsuya"]);
  },
};
