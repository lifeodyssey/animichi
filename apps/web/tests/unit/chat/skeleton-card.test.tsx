/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatActionsProvider } from "../../../src/features/chat/ChatActions";
import { DataPartCard } from "../../../src/features/chat/components/DataPartCard";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { skeletonCopy } from "../../../src/features/chat/skeleton-copy";

afterEach(cleanup);
const zh = chatDictFor("zh");

describe("SkeletonCard content labels", () => {
  it.each([
    ["search_bangumi", "正在接收地点信息"], ["search_nearby", "正在接收地点信息"],
    ["plan_route", "正在接收行程内容"], ["plan_selected", "正在接收行程内容"],
    ["plan_multi", "正在接收行程内容"], ["partial", "正在接收行程内容"],
    ["clarify", "正在接收待确认的信息"], ["general_qa", "正在接收回复"],
  ])("announces %s without pretending to know the result", (intent, label) => {
    render(<DataPartCard data={{ intent }} dict={zh} />);
    expect(screen.getByRole("status").textContent).toBe(label);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each([
    ["zh", "正在接收地点信息"], ["ja", "場所の情報を受信しています"], ["en", "Receiving location details"],
  ] as const)("uses the %s locale", (locale, label) => {
    render(<DataPartCard data={{ intent: "search_bangumi" }} dict={chatDictFor(locale)} />);
    expect(screen.getByRole("status").textContent).toBe(label);
    expect(screen.getByRole("status").closest('[aria-busy="true"]')).toBeNull();
  });
});

describe("SkeletonCard replacement", () => {
  it("replaces the placeholder in place as soon as content arrives", () => {
    const { rerender } = render(<DataPartCard data={{ intent: "general_qa" }} dict={zh} />);
    expect(screen.getByRole("status").textContent).toBe("正在接收回复");
    rerender(<DataPartCard data={{ intent: "general_qa", message: "我们可以先看看东京的取景地。" }} dict={zh} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("我们可以先看看东京的取景地。")).toBeTruthy();
  });

  it.each(["zh", "ja", "en"] as const)("ends the %s waiting state when content never arrived", locale => {
    const dict = chatDictFor(locale), data = { intent: "plan_selected" };
    const { rerender } = render(<DataPartCard data={data} dict={dict} pending />);
    expect(document.querySelector(".chat-card--skeleton")).toBeTruthy();
    rerender(<DataPartCard data={data} dict={dict} pending={false} />);
    expect(document.querySelector(".chat-card--skeleton")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe(skeletonCopy(locale).incomplete);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders an error intent immediately even while the turn is pending", () => {
    render(<ChatActionsProvider actions={{ send: () => undefined, regenerate: () => undefined }}><DataPartCard data={{ intent: "error" }} dict={zh} pending /></ChatActionsProvider>);
    expect(screen.getByRole("alert").textContent).toContain(zh.errorStates.d6Message);
    expect(document.querySelector(".chat-card--skeleton")).toBeNull();
  });

  it("does not replace available content with an incomplete notice when the turn ends", () => {
    render(<DataPartCard data={{ intent: "general_qa", message: "这段回复已收到。" }} dict={zh} pending={false} />);
    expect(screen.getByText("这段回复已收到。")).toBeTruthy();
    expect(screen.queryByText(skeletonCopy(zh.locale).incomplete)).toBeNull();
  });
});
