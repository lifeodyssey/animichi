import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { PlaceMapMarkerPreview, PlaceMapMarkerStates } from "../../../../.storybook/chat-cards/PlaceMapMarkerPreview";
import { chatDictFor } from "../i18n";
import { PlaceMapMarker } from "./PlaceMapMarker";

const meta = {
  title: "Chat/Maps/PlaceMapMarker", component: PlaceMapMarker,
  parameters: { chatViewport: "component", layout: "centered", docs: { description: { component: "Isolated map marker on the existing MapLibre / Protomaps style with repository coordinate fixtures. Names appear on hover, keyboard focus or touch and dismiss on leaving or tapping outside. Picking colors the entire revealed surface with the library primary color. Clicking emits the viewed-place callback; photo-panel integration is deferred." } } },
  globals: { locale: "zh" },
  args: { id: "suga", name: "須賀神社 男坂", position: { leftPct: 50, topPct: 40 }, active: false, selected: false, dict: chatDictFor("zh"), onOpen: fn(), onToggle: fn() },
  render: (args) => <PlaceMapMarkerStates key={`${String(args.active)}-${String(args.selected)}`} {...args} />,
} satisfies Meta<typeof PlaceMapMarker>;
export default meta;
type Story = StoryObj<typeof meta>;
const reveal: Story["play"] = async ({ canvasElement }) => { await userEvent.hover(within(canvasElement).getByRole("button")); };

export const OnMap: Story = { render: (args) => <PlaceMapMarkerPreview key={`${String(args.active)}-${String(args.selected)}`} {...args} /> };
export const Default: Story = {};
export const Open: Story = { play: reveal };
export const Selected: Story = { args: { selected: true } };
export const OpenSelected: Story = { args: { selected: true }, play: reveal };
export const LongName: Story = { args: { name: "東京都新宿区須賀町・須賀神社の男坂（長い名称の表示例）" }, play: reveal };
export const Narrow: Story = { ...OnMap, parameters: { chatViewport: "component-narrow" } };
export const NearEdge: Story = { args: { position: { leftPct: 8, topPct: 85 } }, parameters: { chatViewport: "component-narrow" }, play: reveal };
