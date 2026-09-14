import type { Meta, StoryObj } from "@storybook/react-vite";
import { attachBasemap } from "../../bubble-map/bubble-map-controller";
import { attachFailedBasemap, offRouteSpots, routeStations } from "../../../../.storybook/chat-cards/fixtures";
import { chatDictFor } from "../i18n";
import { RouteTrailMap } from "./RouteTrailMap";

const meta = {
  title: "Chat/Maps/RouteTrailMap",
  component: RouteTrailMap,
  args: { stations: routeStations, dimmed: offRouteSpots, dict: chatDictFor("ja"), attach: attachBasemap },
} satisfies Meta<typeof RouteTrailMap>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OrderedTrail: Story = {};
export const NoOffRouteSpots: Story = { args: { dimmed: [] } };
export const BasemapUnavailable: Story = { args: { attach: attachFailedBasemap } };
export const English: Story = { args: { dict: chatDictFor("en") }, globals: { locale: "en" } };
export const Chinese: Story = { args: { dict: chatDictFor("zh") }, globals: { locale: "zh" } };
