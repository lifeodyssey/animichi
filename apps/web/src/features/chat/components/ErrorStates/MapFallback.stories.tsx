import type { Meta, StoryObj } from "@storybook/react-vite";
import { FailedSearchMapPreview, MapFallbackPreview } from "../../../../../.storybook/chat-errors/MapFallbackPreview";
import { chatDictFor } from "../../i18n";
import { MapFallback } from "./MapFallback";

const meta = {
  title: "Chat/Errors/MapFallback",
  component: MapFallback,
  args: { dict: chatDictFor("zh") }, globals: { locale: "zh" },
  parameters: { chatViewport: "component", layout: "centered", docs: { description: { component: "MapLibre basemap failure stays separate from place results. A static map icon and short status replace the old decorative route doodle and dashed panel. A Google Maps link appears only for finite, valid supplied coordinates, with a 44px target and Animal Island link-button styles. No invented geometry, retry action or unavailable location. FromSearchMap uses the real StaticSpotMap failure branch with an explicit failing-adapter fixture; it does not load replacement tiles or simulate successful recovery." } } },
  argTypes: { dict: { control: false } }, render: args => <MapFallbackPreview {...args} />,
  tags: ["autodocs"],
} satisfies Meta<typeof MapFallback>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DoodleOnly: Story = {};
export const WithMapAppLink: Story = { args: { lat: 35.0116, lng: 135.7681 } };
export const WithoutCoordinates: Story = {};
export const InvalidCoordinates: Story = { args: { lat: 91, lng: 135.7681 } };
export const FromSearchMap: Story = { render: ({ dict }) => <FailedSearchMapPreview dict={dict} /> };
export const NarrowChinese: Story = { ...WithMapAppLink, parameters: { chatViewport: "component-narrow" } };
export const Japanese: Story = { ...NarrowChinese, globals: { locale: "ja" } };
export const English: Story = { ...NarrowChinese, globals: { locale: "en" } };
