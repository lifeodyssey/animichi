import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { SelectionStoryProvider } from "../../../../.storybook/chat-cards/fixtures";
import { tokyoSceneStills } from "../../../../.storybook/chat-cards/scene-fixtures";
import { ChatActionsProvider } from "../ChatActions";
import { chatDictFor } from "../i18n";
import { ResultCardSurface } from "./ResultCardSurface";
import { SpotCardGrid } from "./SearchSpotCard";
import { SelectionTray } from "./SelectionTray";

const actions = { send: fn(), regenerate: fn() };
const recompute = fn();

const meta = {
  title: "Chat/Cards/SearchSpotCard",
  component: SpotCardGrid,
  decorators: [(Story) => <ChatActionsProvider actions={actions}><SelectionStoryProvider><Story /></SelectionStoryProvider></ChatActionsProvider>],
  render: (args) => <div className="grid w-full max-w-xl gap-5"><ResultCardSurface intent="search_bangumi"><SpotCardGrid {...args} /></ResultCardSurface><SelectionTray dict={args.dict} status="idle" onRecompute={recompute} /></div>,
  args: { spots: tokyoSceneStills, dict: chatDictFor("zh") },
} satisfies Meta<typeof SpotCardGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SceneGallery: Story = {};
export const OneSelected: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("checkbox", { name: /須賀神社/u }));
  },
};
export const SelectedPlaces: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("checkbox", { name: /須賀神社/u }));
    await userEvent.click(canvas.getByRole("checkbox", { name: /参宮橋/u }));
  },
};
export const Narrow: Story = { parameters: { chatViewport: "narrow" } };
export const NarrowSelection: Story = { ...SelectedPlaces, parameters: { chatViewport: "narrow" } };
export const LongNames: Story = { args: { spots: tokyoSceneStills.map((spot) => ({ ...spot, name: `${spot.name}・映画のラストシーンに登場する場所` })) } };
export const English: Story = { globals: { locale: "en" } };
export const WithoutImages: Story = { args: { spots: tokyoSceneStills.map((spot) => ({ ...spot, screenshotUrl: undefined })) } };
export const BrokenImage: Story = { args: { spots: tokyoSceneStills.map((spot) => ({ ...spot, screenshotUrl: "/storybook-missing-scene.webp" })) } };
