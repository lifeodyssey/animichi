// no-design-target: design-system primitive / sub-component below the hero blueprint granularity
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { CheckboxGroup } from "./checkbox";

const meta = {
  title: "UI/Checkbox",
  component: CheckboxGroup,
  tags: ["autodocs"],
} satisfies Meta<typeof CheckboxGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

const animeOptions = [
  { label: "響け！ユーフォニアム", value: "euphonium" },
  { label: "たまこまーけっと", value: "tamako" },
  { label: "けいおん！", value: "kon" },
];

export const Default: Story = {
  args: {
    options: animeOptions,
  },
};

export const WithDefaults: Story = {
  args: {
    options: animeOptions,
    defaultValue: ["euphonium", "kon"],
  },
};

export const Small: Story = {
  args: {
    options: animeOptions,
    size: "small",
  },
};

export const Large: Story = {
  args: {
    options: animeOptions,
    size: "large",
  },
};

export const Vertical: Story = {
  args: {
    options: animeOptions,
    direction: "vertical",
    defaultValue: ["tamako"],
  },
};

export const Disabled: Story = {
  args: {
    options: animeOptions,
    disabled: true,
    defaultValue: ["euphonium"],
  },
};

export const PartialDisabled: Story = {
  args: {
    options: [
      { label: "響け！ユーフォニアム", value: "euphonium" },
      { label: "たまこまーけっと", value: "tamako", disabled: true },
      { label: "けいおん！", value: "kon" },
    ],
    defaultValue: ["tamako"],
  },
};

function ControlledCheckbox() {
  const [values, setValues] = useState<Array<string | number>>([]);
  return (
    <div className="flex flex-col gap-3">
      <CheckboxGroup
        options={animeOptions}
        value={values}
        onChange={setValues}
      />
      <p className="text-sm text-muted-foreground">
        選択中: {values.length === 0 ? "なし" : values.join(", ")}
      </p>
    </div>
  );
}

export const Controlled: Story = {
  args: { options: [] },
  render: () => <ControlledCheckbox />,
};
