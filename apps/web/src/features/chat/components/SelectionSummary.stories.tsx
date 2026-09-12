import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { chatDictFor } from "../i18n";
import { SelectionSummary } from "./SelectionSummary";

const meta = {
  title: "Chat/Selection/SelectionSummary", component: SelectionSummary,
  parameters: { chatViewport: "component", layout: "centered", docs: { description: { component: "Isolated selected-place footer. Counts are explicit UI fixtures for distinct places, not photos or viewpoint IDs. Review and planning emit separate callbacks in Storybook Actions; neither opens a page nor calls the existing route-recompute service. The future browser owns deduplication, the review list and model planning." } } },
  globals: { locale: "zh" },
  args: { placeCount: 8, dict: chatDictFor("zh"), busy: false, onReview: fn(), onContinue: fn() },
  argTypes: { placeCount: { control: { type: "number", min: 0, step: 1 } }, dict: { control: false } },
  render: (args) => <div style={{ width: "min(440px, calc(100vw - 80px))", maxWidth: "100%" }}><SelectionSummary {...args} /></div>,
} satisfies Meta<typeof SelectionSummary>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};
export const ManyPlaces: Story = { args: { placeCount: 120 } };
export const OnePlace: Story = { args: { placeCount: 1 } };
export const Empty: Story = { args: { placeCount: 0 } };
export const Preparing: Story = { args: { busy: true } };
export const Narrow: Story = { parameters: { chatViewport: "component-narrow" } };
export const NarrowEnglish: Story = { ...Narrow, globals: { locale: "en" }, args: { placeCount: 1200 } };
export const NarrowJapanese: Story = { ...Narrow, globals: { locale: "ja" }, args: { placeCount: 1200 } };
export const Compact: Story = { ...Narrow, args: { placeCount: 120 }, render: (args) => <div style={{ width: 240, maxWidth: "100%" }}><SelectionSummary {...args} /></div> };
export const KeyboardActions: Story = { play: async ({ canvasElement, args }) => {
  const canvas = within(canvasElement);
  canvas.getByRole("button", { name: "查看所选" }).focus();
  await userEvent.keyboard("{Enter}");
  await expect(args.onReview).toHaveBeenCalledTimes(1);
  await expect(args.onContinue).not.toHaveBeenCalled();
  await userEvent.tab();
  await userEvent.keyboard("{Enter}");
  await expect(args.onContinue).toHaveBeenCalledTimes(1);
} };
