import { describe, expect, it } from "vitest";
import chatCss from "../../src/styles/chat.css?raw";

/* The centred message column moved into the direction-E panel (Tailwind,
   ChatShell.tsx); chat.css no longer owns a page-frame rule. */
describe("chat body column", () => {
  it("declares no hand-written frame rules since the direction-E rebuild", () => {
    /* `ruleDeclaration` THROWS on a missing rule; a deleted selector is the
     * assertion here, so the sheet must simply never name the old frame. */
    expect(chatCss).not.toContain(".chat-body");
    expect(chatCss).not.toContain(".chat-dock");
  });
});
