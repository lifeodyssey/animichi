import type { Meta, StoryObj } from "@storybook/react-vite";
import { attachBasemap } from "../../bubble-map/bubble-map-controller";
import { SelectionStoryProvider, attachFailedBasemap, tokyoSpots, ujiSpots } from "../../../../.storybook/chat-cards/fixtures";
import { chatDictFor } from "../i18n";
import { SearchResult } from "./SearchResult";
import { ResultCardSurface } from "./ResultCardSurface";
import { tokyoSceneStills } from "../../../../.storybook/chat-cards/scene-fixtures";

const meta = {
  title: "Chat/Cards/SearchResult",
  component: SearchResult,
  decorators: [(Story) => <SelectionStoryProvider><ResultCardSurface intent="search_bangumi"><Story /></ResultCardSurface></SelectionStoryProvider>],
  args: { spots: ujiSpots, dict: chatDictFor("ja"), attach: attachBasemap },
} satisfies Meta<typeof SearchResult>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleArea: Story = {};
export const SelectedSpots: Story = {
  render: (args) => <SelectionStoryProvider initial={["uji-bridge", "uji-shrine"]}><SearchResult {...args} /></SelectionStoryProvider>,
};
export const AnimeScene: Story = {
  args: { spots: tokyoSpots.map((spot) => ({ ...spot, ep: undefined, screenshotUrl: tokyoSceneStills.find((scene) => scene.id === spot.id)?.screenshotUrl })) },
};
export const MultipleAreas: Story = { args: { spots: [...ujiSpots, ...tokyoSpots] } };
export const NoResults: Story = { args: { spots: [] } };
export const ResultsWithoutCoordinates: Story = { args: { spots: [{ id: "unknown", name: "場所未確認の候補", ep: 3 }] } };
export const BasemapUnavailable: Story = { args: { attach: attachFailedBasemap } };
export const English: Story = { args: { dict: chatDictFor("en") }, globals: { locale: "en" } };
export const Chinese: Story = { args: { dict: chatDictFor("zh") }, globals: { locale: "zh" } };

export const Narrow: Story = { parameters: { chatViewport: "narrow" }, globals: { viewport: { value: "375-812", isRotated: false } } };
export const LongNames: Story = { args: { spots: ujiSpots.map((spot) => ({ ...spot, name: `${spot.name}・テレビシリーズ最終章の重要な場面` })) } };
export const WithoutImages: Story = { args: { spots: ujiSpots.map((spot) => ({ ...spot, screenshotUrl: undefined })) } };
export const BrokenImage: Story = { args: { spots: ujiSpots.map((spot) => ({ ...spot, screenshotUrl: "/storybook-missing-scene.webp" })) } };
