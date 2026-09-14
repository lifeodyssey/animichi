import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { clarifyPart, parsePart } from "../../../../.storybook/chat-cards/fixtures";
import { chatDictFor } from "../i18n";
import { ClarifyCard } from "./ClarifyCard";
import { DataPartCard } from "./DataPartCard";
import { candidatesOf } from "./Cards";
import { resetGeoPlatform, setGeoPlatform } from "../../../platform/geo";
import { isLocale } from "../../../i18n/locales";

function storyDict(globals: Record<string, unknown>) {
  return chatDictFor(typeof globals.locale === "string" && isLocale(globals.locale) ? globals.locale : "ja");
}

const meta = {
  title: "Chat/Cards/ClarifyCard",
  component: ClarifyCard,
  parameters: { layout: "fullscreen" },
  render: (args) => <DataPartCard data={args.part} dict={args.dict} />,
  args: { part: clarifyPart, dict: chatDictFor("ja") },
} satisfies Meta<typeof ClarifyCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Candidates: Story = {};
export const PhotoUnrecognized: Story = {
  args: { part: parsePart({ intent: "clarify", data: { reason: "photo_unrecognized", candidates: [] } }) },
};
export const MissingLocation: Story = {
  args: { part: parsePart({ intent: "clarify", data: { reason: "missing_location", candidates: [] } }) },
};
export const NoCandidates: Story = { args: { part: parsePart({ intent: "clarify", data: { candidates: [] } }) } };
export const English: Story = { args: { dict: chatDictFor("en") }, globals: { locale: "en" } };
export const Chinese: Story = { args: { dict: chatDictFor("zh") }, globals: { locale: "zh" } };

export const PlaceCandidates: Story = {
  args: { part: parsePart({ intent: "clarify", data: { reason: "place_ambiguity", candidates: [
    { id: "uji-jr", title: "宇治駅（JR奈良線）", lat: 34.8904, lng: 135.8006 },
    { id: "uji-keihan", title: "宇治駅（京阪宇治線）", lat: 34.8946, lng: 135.8061 },
  ] } }) },
};
export const PhotoWithCandidates: Story = {
  args: { part: parsePart({ intent: "clarify", data: { reason: "photo_unrecognized", candidates: candidatesOf(clarifyPart).slice(0, 2) } }) },
};
export const AnimeNotFound: Story = {
  args: { part: parsePart({ intent: "clarify", data: { reason: "anime_not_found", candidates: [] } }) },
};
export const UnknownPlace: Story = {
  args: { part: parsePart({ intent: "clarify", data: { reason: "unknown_place", candidates: [] } }) },
};
export const PlaceTooBroad: Story = {
  args: { part: parsePart({ intent: "clarify", data: { reason: "place_too_broad", candidates: [] } }) },
};
export const GeneralChoices: Story = {
  args: { part: parsePart({ intent: "clarify", message: "どんなペースで歩こうか？", data: { candidates: [
    { title: "寄り道しながら、ゆっくり歩きたい" }, { title: "短い時間で、見どころを巡りたい" },
  ] } }) },
};
export const WithoutCovers: Story = {
  args: { part: parsePart({ intent: "clarify", data: { candidates: candidatesOf(clarifyPart).map((candidate) => ({ ...candidate, cover_url: undefined })) } }) },
};
export const BrokenCover: Story = {
  args: { part: parsePart({ intent: "clarify", data: { candidates: candidatesOf(clarifyPart).map((candidate) => ({ ...candidate, cover_url: "/storybook-missing-cover.jpg" })) } }) },
};
export const MixedCovers: Story = {
  args: { part: parsePart({ intent: "clarify", data: { candidates: [candidatesOf(clarifyPart)[0], { id: "no-cover", title: "リズと青い鳥", title_cn: "莉兹与青鸟" }] } }) },
};
export const Narrow: Story = { parameters: { chatViewport: "narrow" } };
export const Selected: Story = {
  play: async ({ canvasElement }) => {
    const choice = within(within(canvasElement).getByRole("list", { name: "candidates" })).getAllByRole("button")[0];
    if (!choice) throw new Error("The candidate story must contain a choice");
    await userEvent.click(choice);
    await expect(choice).toHaveAttribute("aria-pressed", "true");
  },
};

export const Rephrase: Story = {
  play: async ({ canvasElement, globals }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: storyDict(globals).clarify.escapeHatch }));
    await expect(canvas.getByRole("textbox")).toHaveFocus();
  },
};
export const PlaceRephrase: Story = { ...Rephrase, args: PlaceCandidates.args };
export const PhotoManualEntry: Story = {
  args: PhotoWithCandidates.args,
  play: async ({ canvasElement, globals }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: storyDict(globals).clarify.manualChip }));
    await expect(canvas.getByRole("textbox")).toHaveFocus();
  },
};
export const LocationDenied: Story = {
  args: MissingLocation.args,
  beforeEach: () => { resetGeoPlatform(); return resetGeoPlatform; },
  play: async ({ canvasElement, globals }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: storyDict(globals).location.allow }));
    await expect(canvas.getByRole("status")).toHaveTextContent(storyDict(globals).location.denied);
  },
};
export const LocationPending: Story = {
  args: MissingLocation.args,
  beforeEach: () => { setGeoPlatform({ requestPermission: () => new Promise(() => undefined) }); return resetGeoPlatform; },
  play: async ({ canvasElement, globals }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: storyDict(globals).location.allow }));
    await expect(canvas.getByRole("status")).toHaveTextContent(storyDict(globals).location.waiting);
  },
};
export const LocationGranted: Story = {
  args: MissingLocation.args,
  beforeEach: () => { setGeoPlatform({ requestPermission: () => Promise.resolve({ status: "granted", lat: 34.9, lng: 135.8 }) }); return resetGeoPlatform; },
  play: async ({ canvasElement, globals }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: storyDict(globals).location.allow }));
    await expect(canvas.getByRole("status")).toHaveTextContent(storyDict(globals).location.sent);
  },
};
export const DetailsSent: Story = {
  args: UnknownPlace.args,
  play: async ({ canvasElement, globals }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("textbox"), "京都の宇治駅");
    await userEvent.click(canvas.getByRole("button", { name: storyDict(globals).clarify.submitDetail }));
    await expect(canvas.getByRole("status")).toHaveTextContent(storyDict(globals).clarify.sentDetail);
  },
};
export const NarrowLocation: Story = { args: MissingLocation.args, parameters: { chatViewport: "narrow" } };
export const NarrowPlace: Story = { args: PlaceCandidates.args, parameters: { chatViewport: "narrow" } };
export const ServerMessage: Story = {
  args: { part: parsePart({ intent: "clarify", message: "東京のどのあたりを歩きたい？エリアや駅名を教えてね。", data: { reason: "place_too_broad", candidates: [] } }) },
};
export const NightDetails: Story = { args: NoCandidates.args, decorators: [(Story) => <div data-theme="night"><Story /></div>] };
export const NightCandidates: Story = { decorators: NightDetails.decorators };
export const NightSelected: Story = { ...Selected, decorators: NightDetails.decorators };
