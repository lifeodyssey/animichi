import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, RefObject } from "react";

/**
 * Animal Island `Select` (docs/design/animal-island-ref/component-specs.md
 * §Select): a paper trigger over the design system's distinctive soft-yellow
 * dropdown — 28px radius, 12px vertical padding, a 0.2s fade-in, and a gold
 * pill bar behind the option in force.
 *
 * A native `<select>` cannot carry that popup (the option list is drawn by the
 * OS), so this is an ARIA 1.2 combobox: the trigger owns `aria-expanded` and
 * the listbox, and the open list keeps DOM focus while `aria-activedescendant`
 * moves — which is what lets Arrow/Home/End/Enter/Escape all work without
 * shifting focus off the region.
 */
export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

type SelectProps = Readonly<{
  /** Owns the id namespace: `${id}-label`, `${id}-listbox`, `${id}-opt-N`. */
  id: string;
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
}>;

/** The keyboard's next active option, or `null` when the key is not ours. */
function movedIndex(key: string, index: number, count: number): number | null {
  if (key === "ArrowDown") return (index + 1) % count;
  if (key === "ArrowUp") return (index - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

function indexOfValue(options: readonly SelectOption[], value: string): number {
  return Math.max(0, options.findIndex((option) => option.value === value));
}

function labelOfValue(options: readonly SelectOption[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

interface Dropdown {
  readonly open: boolean;
  readonly active: number;
  readonly toggle: () => void;
  readonly close: (restoreFocus?: boolean) => void;
  readonly setActive: (index: number) => void;
}

/** Open/closed plus the active option, seeded from the value on each open. */
function useDropdown(options: readonly SelectOption[], value: string, triggerRef: RefObject<HTMLButtonElement | null>): Dropdown {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const toggle = useToggle(options, value, setActive, setOpen);
  const close = useClose(setOpen, triggerRef);
  return { open, active, toggle, close, setActive };
}

function useToggle(options: readonly SelectOption[], value: string, setActive: (index: number) => void, setOpen: (value: boolean | ((wasOpen: boolean) => boolean)) => void) {
  return useCallback(() => { setActive(indexOfValue(options, value)); setOpen((wasOpen) => !wasOpen); }, [options, value, setActive, setOpen]);
}

function useClose(setOpen: (value: boolean) => void, triggerRef: RefObject<HTMLButtonElement | null>) {
  return useCallback((restoreFocus = false) => { setOpen(false); if (restoreFocus) triggerRef.current?.focus(); }, [triggerRef, setOpen]);
}

/** The open list takes focus so its own key handler is the one that runs. */
function useListFocus(open: boolean) {
  const ref = useRef<HTMLUListElement | null>(null);
  useEffect(() => { if (open) ref.current?.focus(); }, [open]);
  return ref;
}

type TriggerProps = Readonly<{ id: string; text: string; open: boolean; onToggle: () => void }>;

function keepOpenListFocused(event: MouseEvent, open: boolean): void {
  if (open) event.preventDefault();
}

const SelectTrigger = forwardRef<HTMLButtonElement, TriggerProps>(function SelectTrigger({ id, text, open, onToggle }, ref) {
  return (
    <button ref={ref} type="button" className="ds-select__trigger" role="combobox" aria-labelledby={`${id}-label ${id}-value`} aria-expanded={open} aria-haspopup="listbox" aria-controls={`${id}-listbox`} onMouseDown={(event) => { keepOpenListFocused(event, open); }} onClick={onToggle}>
      <span id={`${id}-value`} className="ds-select__value">{text}</span><span className="ds-select__caret" aria-hidden="true">▾</span>
    </button>
  );
});

type OptionProps = Readonly<{
  id: string; option: SelectOption; index: number; selected: boolean; active: boolean;
  onPick: (index: number) => void;
}>;

function SelectItem({ id, option, index, selected, active, onPick }: OptionProps) {
  const pick = () => { onPick(index); };
  return (
    <li id={`${id}-opt-${String(index)}`} className="ds-select__option" role="option" aria-selected={selected} data-active={active ? "true" : undefined} onClick={pick}>{option.label}</li>
  );
}

type ListProps = Readonly<{
  id: string; options: readonly SelectOption[]; value: string; dropdown: Dropdown;
  onPick: (index: number) => void;
}>;

/** Arrow/Home/End move the active option; Enter/Space commit it; Escape and a
 * focus loss close without committing. */
function useListKeys(dropdown: Dropdown, count: number, onPick: (index: number) => void) {
  return (event: KeyboardEvent) => {
    const moved = movedIndex(event.key, dropdown.active, count);
    if (moved !== null) { event.preventDefault(); dropdown.setActive(moved); return; }
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onPick(dropdown.active); return; }
    if (event.key === "Escape") { event.preventDefault(); dropdown.close(true); }
  };
}

/** A press inside the list must not blur it: the blur handler would close the
 * menu before the option's own click ever ran. */
function keepListFocus(event: MouseEvent): void {
  event.preventDefault();
}

function selectItems({ id, options, value, dropdown, onPick }: ListProps) {
  return options.map((option, index) => (
    <SelectItem key={option.value} id={id} option={option} index={index} selected={option.value === value} active={index === dropdown.active} onPick={onPick} />
  ));
}

function SelectList(props: ListProps) {
  const { id, options, dropdown, onPick } = props;
  const ref = useListFocus(dropdown.open);
  const onKeyDown = useListKeys(dropdown, options.length, onPick);
  if (!dropdown.open) return null;
  return (
    <ul ref={ref} id={`${id}-listbox`} className="ds-select__menu" role="listbox" tabIndex={-1} aria-labelledby={`${id}-label`} aria-activedescendant={`${id}-opt-${String(dropdown.active)}`} onKeyDown={onKeyDown} onBlur={() => { dropdown.close(); }} onMouseDown={keepListFocus}>{selectItems(props)}</ul>
  );
}

/** Commit the option at `index` and close — the one place a value changes. */
function makePicker(options: readonly SelectOption[], value: string, dropdown: Dropdown, onChange: (value: string) => void) {
  return (index: number) => {
    onChange(options[index]?.value ?? value);
    dropdown.close(true);
  };
}

export function Select({ id, label, value, options, onChange }: SelectProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dropdown = useDropdown(options, value, triggerRef);
  const onPick = makePicker(options, value, dropdown, onChange);
  return <div className="ds-select"><span className="ds-select__label" id={`${id}-label`}>{label}</span><SelectTrigger ref={triggerRef} id={id} text={labelOfValue(options, value)} open={dropdown.open} onToggle={dropdown.toggle} /><SelectList id={id} options={options} value={value} dropdown={dropdown} onPick={onPick} /></div>;
}
