import type { Meta, StoryObj } from "@storybook/react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardAction,
} from "./card";
import { Button } from "./button";
import { Badge } from "./badge";

const meta = {
  title: "UI/Card",
  component: Card,
  tags: ["autodocs"],
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Card className="w-72">
      <CardHeader>
        <CardTitle>宇治神社</CardTitle>
        <CardDescription>京都府宇治市宇治山田1</CardDescription>
      </CardHeader>
      <CardContent>
        <p>「響け！ユーフォニアム」の聖地スポットです。</p>
      </CardContent>
    </Card>
  ),
};

export const WithFooter: Story = {
  render: () => (
    <Card className="w-72">
      <CardHeader>
        <CardTitle>平等院鳳凰堂</CardTitle>
        <CardDescription>京都府宇治市宇治蓮華116</CardDescription>
      </CardHeader>
      <CardContent>
        <p>EP 3のオープニングシーンに登場する世界遺産。</p>
      </CardContent>
      <CardFooter>
        <Button size="sm">ルートに追加</Button>
      </CardFooter>
    </Card>
  ),
};

export const WithAction: Story = {
  render: () => (
    <Card className="w-72">
      <CardHeader>
        <CardTitle>大吉山展望台</CardTitle>
        <CardAction>
          <Badge>EP 1-4</Badge>
        </CardAction>
        <CardDescription>宇治市の絶景スポット</CardDescription>
      </CardHeader>
      <CardContent>
        <p>久美子たちが練習する山道の近くにある展望台。</p>
      </CardContent>
    </Card>
  ),
};

export const Small: Story = {
  render: () => (
    <Card size="sm" className="w-64">
      <CardHeader>
        <CardTitle>宇治橋</CardTitle>
        <CardDescription>宇治川に架かる橋</CardDescription>
      </CardHeader>
      <CardContent>
        <p>日本三古橋のひとつ。</p>
      </CardContent>
    </Card>
  ),
};
