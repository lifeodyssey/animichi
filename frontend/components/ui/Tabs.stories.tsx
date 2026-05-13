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
      <TabsContent value="spots">宇治市の聖地スポット一覧が表示されます。</TabsContent>
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
      <TabsContent value="visited">訪問済みスポットを表示中。</TabsContent>
      <TabsContent value="unvisited">未訪問スポットを表示中。</TabsContent>
    </Tabs>
  ),
};

export const Vertical: Story = {
  render: () => (
    <Tabs defaultValue="kyoto" orientation="vertical" className="w-80">
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
