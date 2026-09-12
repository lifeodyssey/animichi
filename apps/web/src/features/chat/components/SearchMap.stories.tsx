import type { Meta, StoryObj } from "@storybook/react-vite";
import { attachBasemap } from "../../bubble-map/bubble-map-controller";
import { attachFailedBasemap, tokyoSpots, ujiSpots } from "../../../../.storybook/chat-cards/fixtures";
import { clusterSpots, locatedSpots } from "../lib/spot-clusters";
import { chatDictFor } from "../i18n";
import { ClusterBubbleMap, StaticSpotMap } from "./SearchMap";

const dict = chatDictFor("ja");
const clusters = clusterSpots(locatedSpots([...ujiSpots, ...tokyoSpots]));

const meta = { title: "Chat/Maps/SearchMap", parameters: { layout: "padded" } } satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const StaticPins: Story = {
  render: () => <StaticSpotMap spots={locatedSpots(ujiSpots)} dict={dict} attach={attachBasemap} maxPins={50} />,
};

export const ClusterOverview: Story = {
  render: () => <ClusterBubbleMap clusters={clusters} dict={dict} attach={attachBasemap} onSelect={() => undefined} refocusIndex={null} />,
};

export const StaticMapFallback: Story = {
  render: () => <StaticSpotMap spots={locatedSpots(ujiSpots)} dict={dict} attach={attachFailedBasemap} maxPins={50} />,
};

export const ClusterMapFallback: Story = {
  render: () => <ClusterBubbleMap clusters={clusters} dict={dict} attach={attachFailedBasemap} onSelect={() => undefined} refocusIndex={null} />,
};
