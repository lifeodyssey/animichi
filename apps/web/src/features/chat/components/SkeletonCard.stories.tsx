import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { SkeletonPreview, SkeletonTransitionPreview, SkeletonWithMessage, skeletonPreviewCopy, skeletonPreviewDict } from "../../../../.storybook/chat-streaming/SkeletonPreview";
import { chatDictFor } from "../i18n";
import { skeletonCopy } from "../skeleton-copy";
import { DataPartCard } from "./DataPartCard";

const meta = {
  title: "Chat/Streaming/SkeletonCard",
  component: DataPartCard,
  parameters: { chatViewport: "component", layout: "centered", docs: { description: { component: "Intent-first content uses the existing quiet TypingIndicator and Animal Island semantic colors, with no pulsing card, artificial image slots, counts or completion estimates. The intent only names the incoming content. Full data replaces the placeholder immediately; a settled intent-only frame becomes a static incomplete-content notice without a new retry action. Invalid and failed envelopes retain their existing fallbacks. Live status is not muted by aria-busy; reduced motion keeps the mark static. Message text and clarification results are authored frontend fixtures. Transition controls only replace local DataPartCard props, without requests, page changes or automatic progress." } } },
  globals: { locale: "zh" },
  args: { data: { intent: "plan_route" }, dict: chatDictFor("zh"), pending: true },
  argTypes: { dict: { control: false }, data: { control: false } },
  render: args => <SkeletonPreview {...args} />,
} satisfies Meta<typeof DataPartCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PlanningRoute: Story = {};
export const Searching: Story = { args: { data: { intent: "search_bangumi" } } };
export const Nearby: Story = { args: { data: { intent: "search_nearby" } } };
export const Clarifying: Story = { args: { data: { intent: "clarify" } } };
export const Replying: Story = { args: { data: { intent: "general_qa" } } };
export const PendingEndedWithoutPayload: Story = { args: { pending: false } };
export const WithMessage: Story = { ...Searching, render: args => <SkeletonWithMessage {...args} /> };
export const IncompleteWithMessage: Story = { ...WithMessage, args: { ...Searching.args, pending: false } };
export const ContentTransition: Story = { render: ({ dict }) => <SkeletonTransitionPreview dict={dict} /> };
export const ContentReceived: Story = {
  ...ContentTransition,
  play: async ({ canvasElement, globals }) => {
    const canvas = within(canvasElement), dict = skeletonPreviewDict(globals.locale);
    await userEvent.click(canvas.getByRole("button", { name: skeletonPreviewCopy(dict.locale).ready }));
    await expect(canvas.queryByRole("status")).not.toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: dict.clarify.choosePrompt })).toBeVisible();
  },
};
export const TransitionEndedWithoutPayload: Story = {
  ...ContentTransition,
  play: async ({ canvasElement, globals }) => {
    const canvas = within(canvasElement), dict = skeletonPreviewDict(globals.locale);
    await userEvent.click(canvas.getByRole("button", { name: skeletonPreviewCopy(dict.locale).incomplete }));
    await expect(canvas.getByRole("status")).toHaveTextContent(skeletonCopy(dict.locale).incomplete);
  },
};
export const Narrow: Story = { ...WithMessage, parameters: { chatViewport: "component-narrow" } };
export const English: Story = { ...Narrow, globals: { locale: "en" } };
export const Japanese: Story = { ...Narrow, globals: { locale: "ja" } };
export const Chinese: Story = { ...Narrow, globals: { locale: "zh" } };
export const IncompleteEnglish: Story = { ...IncompleteWithMessage, parameters: { chatViewport: "component-narrow" }, globals: { locale: "en" } };
