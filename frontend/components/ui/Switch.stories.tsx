import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Switch } from "./switch";

const meta = {
  title: "UI/Switch",
  component: Switch,
  tags: ["autodocs"],
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
};

export const Checked: Story = {
  args: { defaultChecked: true },
};

export const Small: Story = {
  args: { size: "small" },
};

export const SmallChecked: Story = {
  args: { size: "small", defaultChecked: true },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const DisabledChecked: Story = {
  args: { disabled: true, defaultChecked: true },
};

export const WithLabels: Story = {
  args: {
    defaultChecked: true,
    checkedChildren: "ON",
    unCheckedChildren: "OFF",
  },
};

function ControlledSwitch() {
  const [on, setOn] = useState(false);
  return (
    <div className="flex items-center gap-3">
      <Switch checked={on} onChange={setOn} />
      <span className="text-sm text-foreground">
        {on ? "通知オン" : "通知オフ"}
      </span>
    </div>
  );
}

export const Controlled: Story = {
  render: () => <ControlledSwitch />,
};
