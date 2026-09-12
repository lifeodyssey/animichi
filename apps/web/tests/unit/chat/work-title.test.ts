import { describe, expect, it } from "vitest";
import { localizedWorkTitle } from "../../../src/features/chat/lib/work-title";
import type { WorkTitleLike } from "../../../src/features/chat/lib/work-title";

const bilingual = { title: "響け！ユーフォニアム", title_cn: "吹响吧！上低音号" };

describe("work titles follow the reader's language", () => {
  it("leads with the Chinese title for Chinese readers", () => {
    expect(localizedWorkTitle(bilingual, "zh")).toEqual({ primary: bilingual.title_cn, secondary: bilingual.title });
  });

  it.each(["ja", "en"] as const)("leads with the original title in %s", (locale) => {
    expect(localizedWorkTitle(bilingual, locale)).toEqual({ primary: bilingual.title, secondary: bilingual.title_cn });
  });

  it.each<readonly [WorkTitleLike, string]>([
    [{ title: "原題" }, "原題"],
    [{ title_cn: "译名" }, "译名"],
    [{ title: "   ", title_cn: "译名" }, "译名"],
    [{ title: "原題", title_cn: "" }, "原題"],
    [{ id: "115908" }, "115908"],
    [{}, ""],
    [{ id: null, title: null, title_cn: null }, ""],
    [{ title: " 同名 ", title_cn: "同名" }, "同名"],
  ])("uses the available title without an empty or duplicate subtitle: %o", (work, primary) => {
    expect(localizedWorkTitle(work, "zh")).toEqual({ primary });
    expect(localizedWorkTitle(work, "ja")).toEqual({ primary });
  });
});
