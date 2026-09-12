import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { SelectedPlacesListPreview } from "../../../../.storybook/chat-cards/SelectedPlacesListPreview";
import { manySelectedPlaces, selectedPlaceFixtures } from "../../../../.storybook/chat-cards/selected-place-fixtures";
import { chatDictFor } from "../i18n";
import { SelectedPlacesList } from "./SelectedPlacesList";

const meta = {
  title: "Chat/Selection/SelectedPlacesList", component: SelectedPlacesList,
  parameters: { chatViewport: "component", layout: "centered", docs: { description: { component: "Isolated controlled selection review. Existing place names/images; grouping and large-volume fixtures are synthetic, not live catalog clustering. Expand multiple selected viewpoints, preview frames, remove a place or viewpoint, and undo the last removal. Back emits an action; page navigation and browser-position restoration remain unwired." } } },
  globals: { locale: "zh" },
  args: { places: selectedPlaceFixtures, dict: chatDictFor("zh"), onBack: fn(), onChange: fn() },
  argTypes: { dict: { control: false } },
  render: (args) => <SelectedPlacesListPreview key={JSON.stringify(args.places)} {...args} />,
} satisfies Meta<typeof SelectedPlacesList>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Expanded: Story = { play: async ({ canvasElement }) => { await userEvent.click(within(canvasElement).getByRole("button", { name: "展开取景位置: 須賀神社 男坂" })); } };
export const OnePlace: Story = { args: { places: selectedPlaceFixtures.slice(1, 2) } };
export const Empty: Story = { args: { places: [] } };
export const MissingImage: Story = { args: { places: [{ ...selectedPlaceFixtures[1], viewpoints: [{ id: "crossing", frames: [] }] }] } };
export const FailedImage: Story = { args: { places: [{ ...selectedPlaceFixtures[1], viewpoints: [{ id: "crossing", frames: [{ id: "failed", url: "/unavailable-selected-place.webp" }] }] }] } };
export const Narrow: Story = { parameters: { chatViewport: "component-narrow" } };
export const LongName: Story = { ...Narrow, args: { places: [{ ...selectedPlaceFixtures[1], name: "東京都渋谷区代々木・小田急線参宮橋1号踏切（長い名称の表示例）" }] } };
export const ManyPlaces: Story = { args: { places: manySelectedPlaces } };
export const ManyFrames: Story = { args: { places: [{ ...selectedPlaceFixtures[1], viewpoints: [{ id: "crossing", frames: Array.from({ length: 520 }, (_, index) => ({ id: `frame-${String(index)}`, url: "/images/compare/anime.jpg" })) }] }] } };
export const English: Story = { globals: { locale: "en" }, parameters: { chatViewport: "component-narrow" } };
export const Japanese: Story = { globals: { locale: "ja" }, parameters: { chatViewport: "component-narrow" } };
export const RemovalUndo: Story = { play: async ({ canvasElement }) => { await userEvent.click(within(canvasElement).getByRole("button", { name: "移除地点: 参宮橋 1号踏切" })); } };
