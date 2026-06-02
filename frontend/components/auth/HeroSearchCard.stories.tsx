import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import HeroSearchCard from "./HeroSearchCard";
import FoxGuide from "@/components/generative/FoxGuide";

const meta = {
  title: "Landing/Hero/SearchCard",
  component: HeroSearchCard,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Right hero card — the single focal action: input, pumpkin-orange Explore CTA, dashed route preview, example chips, with the fox peeking over the corner.",
      },
    },
  },
} satisfies Meta<typeof HeroSearchCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const EXAMPLES = ["君の名は。", "響け！ユーフォニアム", "天気の子"];

// Stories drive their own state via <Demo>; args satisfy the typed meta only.
const baseArgs = {
  query: "",
  onQueryChange: () => {},
  onSearch: () => {},
  examples: EXAMPLES,
  onChip: () => {},
  placeholder: "Enter anime, station, or city",
  ctaLabel: "Start Exploring",
  nearbyLabel: "Nearby spots",
};

function Demo({ initial = "", withFox = true }: { initial?: string; withFox?: boolean }) {
  const [query, setQuery] = useState(initial);
  return (
    <div className="relative w-[400px]">
      {withFox ? (
        <FoxGuide
          pose="welcome"
          size="md"
          surface="welcome"
          className="-top-[3.75rem] right-3 z-0"
        />
      ) : null}
      <div className="relative z-10">
        <HeroSearchCard
          query={query}
          onQueryChange={setQuery}
          onSearch={() => {}}
          examples={EXAMPLES}
          onChip={setQuery}
          placeholder="Enter anime, station, or city"
          ctaLabel="Start Exploring"
          nearbyLabel="Nearby spots"
        />
      </div>
    </div>
  );
}

export const Empty: Story = {
  name: "Empty input",
  args: baseArgs,
  render: () => <Demo />,
};

export const Filled: Story = {
  name: "Filled",
  args: baseArgs,
  render: () => <Demo initial="君の名は。" />,
};

export const WithoutFox: Story = {
  name: "Card only",
  args: baseArgs,
  render: () => <Demo withFox={false} />,
};
