import { describe, expect, it } from "vitest";
import chatCss from "../../src/styles/chat.css?raw";
import { ruleDeclaration } from "./_token-helpers";

describe("chat bubble sizing", () => {
  it("shrinks bubbles to their content instead of the full column", () => {
    expect(ruleDeclaration(chatCss, ".chat-bubble", "width")).toBe("fit-content");
  });

  it("keeps a readable max width on bubbles", () => {
    expect(ruleDeclaration(chatCss, ".chat-bubble", "max-width")).toBe("42rem");
  });

  it("aligns user bubbles to the end of the column", () => {
    const selector = ".chat-message--user .chat-bubble";
    expect(ruleDeclaration(chatCss, selector, "align-self")).toBe("flex-end");
    expect(ruleDeclaration(chatCss, selector, "margin-left")).toBe("auto");
  });
});

describe("chat body column", () => {
  it("centers the message column on wide viewports", () => {
    expect(ruleDeclaration(chatCss, ".chat-body", "max-width")).toBe("48rem");
    expect(ruleDeclaration(chatCss, ".chat-body", "margin-inline")).toBe("auto");
    expect(ruleDeclaration(chatCss, ".chat-body", "width")).toBe("100%");
  });
});
