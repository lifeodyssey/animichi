import type { Meta, StoryObj } from "@storybook/react";
import { ErrorRetryTicket } from "./ErrorRetryTicket";

const meta = {
  title: "Generative/ErrorRetryTicket",
  component: ErrorRetryTicket,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Ticket-style error card with perforated edges and torii stamp. Used for state 12 (error path) in ResultPanel. Retry is locked after first click to prevent double-fire.",
      },
    },
  },
  tags: ["autodocs"],
  decorators: [
    (Story: React.ComponentType) => (
      <div style={{ width: 380, padding: 24 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ErrorRetryTicket>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    onRetry: () => console.log("retry"),
    onEditQuery: () => console.log("edit query"),
    onRestart: () => console.log("restart"),
    onReport: () => console.log("report"),
  },
};

export const RetryOnly: Story = {
  name: "Retry only (no secondary actions)",
  args: {
    onRetry: () => console.log("retry"),
  },
};

export const WithSecondaryActions: Story = {
  name: "With restart + report links",
  args: {
    onRetry: () => {},
    onEditQuery: () => {},
    onRestart: () => {},
    onReport: () => {},
  },
};
