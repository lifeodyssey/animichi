import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { chatDictFor } from "../i18n";
import { SceneGroupCard } from "./SceneGroupCard";
import { SceneGroupCardPreview } from "../../../../.storybook/chat-cards/SceneGroupCardPreview";

// Existing comparison assets only. Provenance: public/images/landing/ATTRIBUTIONS.md.
const viewpoint = { id: "stairs", frames: [
  { id: "scene", url: "/images/landing/suga-shrine-anime-source.webp", caption: "君の名は。 · 场景参照" },
  { id: "real", url: "/images/landing/suga-shrine-reality-perspective-v2.webp", caption: "实景参照 · Hisagi / CC BY-SA 4.0" },
] };

const meta = {
  title: "Chat/Cards/SceneGroupCard", component: SceneGroupCard,
  parameters: { chatViewport: "component", layout: "centered", docs: { description: { component: "Isolated frontend card. Place name and images reuse existing repository fixtures. Frame grouping is a Storybook example, not a live catalog response; no invented viewpoint labels." } } }, globals: { locale: "zh" },
  args: { placeName: "須賀神社 男坂", viewpoint, dict: chatDictFor("zh"), selected: false, onToggle: fn() },
  render: (args) => <SceneGroupCardPreview key={String(args.selected)} {...args} />,
} satisfies Meta<typeof SceneGroupCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Selected: Story = { args: { selected: true } };
export const SingleFrame: Story = { args: { viewpoint: { ...viewpoint, frames: viewpoint.frames.slice(0, 1) } } };
export const MissingImages: Story = { args: { viewpoint: { ...viewpoint, frames: [] } } };
export const FailedImage: Story = { args: { viewpoint: { ...viewpoint, frames: [{ id: "failed", url: "/unavailable-scene.webp" }] } } };
export const LongName: Story = { args: { placeName: "東京都新宿区須賀町・須賀神社の男坂（長い名称の表示例）" } };
export const Narrow: Story = { parameters: { chatViewport: "component-narrow" } };
export const ManyFrames: Story = { args: { viewpoint: { ...viewpoint, frames: Array.from({ length: 520 }, (_, index) => ({ ...viewpoint.frames[0], id: `frame-${String(index)}` })) } } };
