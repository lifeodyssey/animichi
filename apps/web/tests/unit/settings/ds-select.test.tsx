/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Select, type SelectOption } from "../../../src/components/ds/Select";

afterEach(cleanup);

const FRUIT: readonly SelectOption[] = [
  { value: "ume", label: "梅" },
  { value: "sakura", label: "桜" },
  { value: "kaede", label: "楓" },
];

/** A mounted Select on the middle option, plus the change spy watching it. */
function makeMountedSelect(value = "sakura") {
  const onChange = vi.fn();
  render(<Select id="fruit" label="Fruit" value={value} options={FRUIT} onChange={onChange} />);
  return { onChange, trigger: screen.getByRole("combobox") };
}

/** A mounted Select with its menu already open, plus that instance's spy. */
function makeOpenSelect() {
  const { onChange, trigger } = makeMountedSelect();
  fireEvent.click(trigger);
  return { onChange, list: screen.getByRole("listbox") };
}

describe("DS Select — closed state", () => {
  it("names itself from the label and shows the option in force", () => {
    const { trigger } = makeMountedSelect();
    expect(trigger.getAttribute("aria-labelledby")).toBe("fruit-label fruit-value");
    expect(document.getElementById("fruit-label")?.textContent).toBe("Fruit");
    expect(screen.getByRole("combobox", { name: "Fruit 桜" })).toBe(trigger);
    expect(trigger.textContent).toContain("桜");
  });

  it("reports collapsed and renders no listbox", () => {
    makeMountedSelect();
    expect(screen.getByRole("combobox").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("falls back to the raw value when it matches no option", () => {
    makeMountedSelect("matsu");
    expect(screen.getByRole("combobox").textContent).toContain("matsu");
  });
});

describe("DS Select — opening", () => {
  it("expands, takes focus, and marks the option in force as active", () => {
    const { list } = makeOpenSelect();
    expect(screen.getByRole("combobox").getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(list);
    expect(list.getAttribute("aria-activedescendant")).toBe("fruit-opt-1");
  });

  it("marks exactly the option in force as selected", () => {
    makeOpenSelect();
    const selected = screen.getAllByRole("option").map((item) => item.getAttribute("aria-selected"));
    expect(selected).toEqual(["false", "true", "false"]);
  });

  it("closes again from the trigger", () => {
    const { trigger } = makeMountedSelect();
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes from a real pointer click while the list owns focus", async () => {
    const user = userEvent.setup();
    const { trigger } = makeMountedSelect();
    await user.click(trigger);
    await user.click(trigger);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("DS Select — keyboard", () => {
  it.each([
    ["ArrowDown", "fruit-opt-2"],
    ["ArrowUp", "fruit-opt-0"],
    ["Home", "fruit-opt-0"],
    ["End", "fruit-opt-2"],
  ])("%s moves the active option to %s", (key, expected) => {
    const { list } = makeOpenSelect();
    fireEvent.keyDown(list, { key });
    expect(list.getAttribute("aria-activedescendant")).toBe(expected);
  });

  it("wraps past the last option back to the first", () => {
    const { list } = makeOpenSelect();
    fireEvent.keyDown(list, { key: "End" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(list.getAttribute("aria-activedescendant")).toBe("fruit-opt-0");
  });

  it("ignores keys it does not own", () => {
    const { list } = makeOpenSelect();
    fireEvent.keyDown(list, { key: "a" });
    expect(list.getAttribute("aria-activedescendant")).toBe("fruit-opt-1");
  });
});

describe("DS Select — committing a choice", () => {
  it("commits the active option on Enter and closes", () => {
    const { list, onChange } = makeOpenSelect();
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("kaede");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("combobox"));
  });

  it("commits on Space too", () => {
    const { list, onChange } = makeOpenSelect();
    fireEvent.keyDown(list, { key: " " });
    expect(onChange).toHaveBeenCalledWith("sakura");
  });

  it("commits the pressed option on click", () => {
    const { onChange } = makeOpenSelect();
    fireEvent.click(screen.getByRole("option", { name: "梅" }));
    expect(onChange).toHaveBeenCalledWith("ume");
    expect(document.activeElement).toBe(screen.getByRole("combobox"));
  });
});

describe("DS Select — dismissal without a choice", () => {
  it("closes on Escape and commits nothing", () => {
    const { list, onChange } = makeOpenSelect();
    fireEvent.keyDown(list, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("combobox"));
  });

  it("closes when focus leaves the list", () => {
    const { list } = makeOpenSelect();
    fireEvent.blur(list);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("keeps the list open when a press starts inside it", () => {
    const { list } = makeOpenSelect();
    const held = fireEvent.mouseDown(list);
    expect(held).toBe(false);
    expect(screen.getByRole("listbox")).toBeTruthy();
  });
});
