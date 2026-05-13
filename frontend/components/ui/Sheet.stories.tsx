import type { Meta, StoryObj } from "@storybook/react";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
} from "./sheet";
import { Button } from "./button";

const meta = {
  title: "UI/Sheet",
  component: Sheet,
  tags: ["autodocs"],
} satisfies Meta<typeof Sheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger render={<Button variant="outline">聖地詳細を開く</Button>} />
      <SheetContent>
        <SheetHeader>
          <SheetTitle>宇治神社</SheetTitle>
          <SheetDescription>京都府宇治市宇治山田1</SheetDescription>
        </SheetHeader>
        <div className="px-4">
          <p>「響け！ユーフォニアム」の主要な聖地スポットです。久美子たちが練習するシーンのロケ地となっています。</p>
        </div>
        <SheetFooter>
          <SheetClose render={<Button variant="outline">閉じる</Button>} />
          <Button>ルートに追加</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ),
};

export const FromLeft: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger render={<Button variant="outline">メニューを開く</Button>} />
      <SheetContent side="left">
        <SheetHeader>
          <SheetTitle>聖地巡礼メニュー</SheetTitle>
        </SheetHeader>
        <div className="px-4 flex flex-col gap-2">
          <Button variant="ghost" className="justify-start">マイルート</Button>
          <Button variant="ghost" className="justify-start">訪問済みスポット</Button>
          <Button variant="ghost" className="justify-start">お気に入り作品</Button>
        </div>
      </SheetContent>
    </Sheet>
  ),
};

export const FromBottom: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger render={<Button variant="outline">フィルターを開く</Button>} />
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>絞り込み</SheetTitle>
          <SheetDescription>表示するスポットを絞り込みます。</SheetDescription>
        </SheetHeader>
        <div className="px-4">
          <p>フィルターオプションがここに入ります。</p>
        </div>
        <SheetFooter>
          <Button className="w-full">適用する</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ),
};
