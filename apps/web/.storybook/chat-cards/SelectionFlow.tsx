import type { ComponentProps } from "react";
import { ComposerDock } from "../../src/features/chat/components/ComposerDock";
import { ResultCardSurface } from "../../src/features/chat/components/ResultCardSurface";
import { SearchResult } from "../../src/features/chat/components/SearchResult";
import { SelectionTray } from "../../src/features/chat/components/SelectionTray";
import { SelectionStoryProvider, ujiSpots } from "./fixtures";

/** Real search, selection and composer surfaces sharing one selection scope. */
export function SelectionFlow(props: ComponentProps<typeof SelectionTray>) {
  return (
    <SelectionStoryProvider initial={["uji-bridge", "keihan-uji"]}>
      <div className="mx-auto grid w-full max-w-[916px] gap-6">
        <div className="px-7 max-lg:px-4"><ResultCardSurface intent="search_bangumi"><SearchResult spots={ujiSpots} dict={props.dict} /></ResultCardSurface></div>
        <div><SelectionTray {...props} /><ComposerDock dict={props.dict} baseUrl="/storybook" photo={{ locale: "ja" }} gate={{ locked: false, busy: false, failed: false }} quotaLocked={false} onSend={() => undefined} /></div>
      </div>
    </SelectionStoryProvider>
  );
}
