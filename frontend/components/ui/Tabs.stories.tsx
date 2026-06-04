// no-design-target: design-system primitive / sub-component below the hero blueprint granularity
import type { Meta, StoryObj } from "@storybook/react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs";

const meta = {
  title: "UI/Tabs",
  component: Tabs,
  tags: ["autodocs"],
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Tabs defaultValue="spots">
      <TabsList>
        <TabsTrigger value="spots">聖地一覧</TabsTrigger>
        <TabsTrigger value="route">ルート</TabsTrigger>
        <TabsTrigger value="info">作品情報</TabsTrigger>
      </TabsList>
      <TabsContent value="spots">
        宇治市の聖地スポット一覧が表示されます。
      </TabsContent>
      <TabsContent value="route">最適ルートが表示されます。</TabsContent>
      <TabsContent value="info">アニメ詳細情報が表示されます。</TabsContent>
    </Tabs>
  ),
};

export const LineVariant: Story = {
  render: () => (
    <Tabs defaultValue="all">
      <TabsList variant="line">
        <TabsTrigger value="all">すべて</TabsTrigger>
        <TabsTrigger value="visited">訪問済み</TabsTrigger>
        <TabsTrigger value="unvisited">未訪問</TabsTrigger>
      </TabsList>
      <TabsContent value="all">全スポットを表示中。</TabsContent>
      <TabsContent value="visited">
        訪問済みスポットを表示中。
      </TabsContent>
      <TabsContent value="unvisited">
        未訪問スポットを表示中。
      </TabsContent>
    </Tabs>
  ),
};

export const Vertical: Story = {
  render: () => (
    <Tabs defaultValue="kyoto" orientation="vertical" className="w-96">
      <TabsList>
        <TabsTrigger value="kyoto">京都府</TabsTrigger>
        <TabsTrigger value="aichi">愛知県</TabsTrigger>
        <TabsTrigger value="tokyo">東京都</TabsTrigger>
      </TabsList>
      <TabsContent value="kyoto">京都の聖地スポット。</TabsContent>
      <TabsContent value="aichi">愛知の聖地スポット。</TabsContent>
      <TabsContent value="tokyo">東京の聖地スポット。</TabsContent>
    </Tabs>
  ),
};

export const ManyTabs: Story = {
  name: "Many Tabs",
  render: () => (
    <Tabs defaultValue="ep1">
      <TabsList>
        <TabsTrigger value="ep1">EP 1</TabsTrigger>
        <TabsTrigger value="ep2">EP 2</TabsTrigger>
        <TabsTrigger value="ep3">EP 3</TabsTrigger>
        <TabsTrigger value="ep4">EP 4</TabsTrigger>
        <TabsTrigger value="ep5">EP 5</TabsTrigger>
      </TabsList>
      <TabsContent value="ep1">
        第1話の聖地スポット。宇治駅前広場が登場。
      </TabsContent>
      <TabsContent value="ep2">
        第2話の聖地スポット。宇治川沿いの散歩道。
      </TabsContent>
      <TabsContent value="ep3">
        第3話の聖地スポット。平等院周辺エリア。
      </TabsContent>
      <TabsContent value="ep4">
        第4話の聖地スポット。大吉山展望台。
      </TabsContent>
      <TabsContent value="ep5">
        第5話の聖地スポット。宇治神社と宇治上神社。
      </TabsContent>
    </Tabs>
  ),
};

export const WithDisabled: Story = {
  name: "With Disabled Tab",
  render: () => (
    <Tabs defaultValue="spots">
      <TabsList>
        <TabsTrigger value="spots">聖地一覧</TabsTrigger>
        <TabsTrigger value="route">ルート</TabsTrigger>
        <TabsTrigger value="premium" disabled>
          プレミアム
        </TabsTrigger>
      </TabsList>
      <TabsContent value="spots">
        聖地スポット一覧が表示されます。
      </TabsContent>
      <TabsContent value="route">ルートが表示されます。</TabsContent>
    </Tabs>
  ),
};
