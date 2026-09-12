import type { Meta, StoryObj } from "@storybook/react-vite";
import { BROKEN_SCENE_SOURCE, SCENE_SOURCE, SceneSourceChanged, SceneThumbPreview } from "../../../../../.storybook/chat-errors/SceneThumbPreview";
import { chatDictFor } from "../../i18n";
import { SceneThumb } from "./SceneThumb";

const meta = {
  title: "Chat/Errors/SceneThumb",
  component: SceneThumb,
  args: { alt: "宇治橋", dict: chatDictFor("zh") }, globals: { locale: "zh" },
  parameters: { chatViewport: "component", layout: "centered", docs: { description: { component: "A stable thumbnail slot for an available, absent or failed image. Missing media uses the same quiet photo icon as selected places; supplied episode metadata remains visible and the accessible name distinguishes missing from failed. Invalid episode values are omitted. The slot keeps its dimensions and a corrected source retries naturally. Examples reuse an existing Uji asset and name; no new art, inferred angle, invented image or episode data. SourceChanged switches between a deliberate local 404 and the existing asset, entirely in Storybook." } } },
  argTypes: { dict: { control: false } }, render: args => <SceneThumbPreview {...args} />,
  tags: ["autodocs"],
} satisfies Meta<typeof SceneThumb>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MissingImage: Story = { args: { ep: 8 } };
export const MissingEpisode: Story = {};
export const AvailableImage: Story = { args: { src: SCENE_SOURCE, ep: 8 } };
export const BrokenImage: Story = { args: { src: BROKEN_SCENE_SOURCE, ep: 8 } };
export const BlankSource: Story = { args: { src: " " } };
export const SourceChanged: Story = { render: ({ dict }) => <SceneSourceChanged dict={dict} /> };
export const LongName: Story = { args: { alt: "宇治橋 — Uji Bridge / 宇治川沿い", ep: 8 }, parameters: { chatViewport: "component-narrow" } };
export const Japanese: Story = { ...MissingImage, globals: { locale: "ja" } };
export const English: Story = { ...MissingImage, globals: { locale: "en" } };
