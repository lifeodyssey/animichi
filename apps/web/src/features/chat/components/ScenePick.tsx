import { Checkbox } from "animal-island-ui-tailwind/checkbox";
import { Cursor } from "animal-island-ui-tailwind/cursor";

type Props = Readonly<{ id: string; label: string; selected: boolean; onToggle: () => void; disabled?: boolean; appearance?: "circle" | "plain" }>;
const PICK = "absolute inset-0 z-10 [&_.animal-checkbox-item]:size-full [&_.animal-checkbox-box]:absolute [&_.animal-checkbox-box]:inset-0 [&_.animal-checkbox-box]:size-full [&_.animal-checkbox-box]:cursor-pointer [&_.animal-checkbox-box]:opacity-0 [&_.animal-checkbox-box]:transform-none [&_.animal-checkbox-label]:sr-only";
const FRAME = "relative size-11 shrink-0 rounded-full has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ground-ink";
const MARK = "pointer-events-none absolute inset-1.5 grid place-items-center rounded-full bg-paper text-primary-strong ring-1 ring-border-soft data-[selected=true]:bg-primary-strong data-[selected=true]:text-paper data-[selected=true]:ring-primary-strong";
const PLAIN_MARK = "pointer-events-none absolute inset-1.5 grid place-items-center rounded-full text-current";

/** The visual corner button and the library's accessible checkbox share one target. */
export function ScenePick({ id, label, selected, onToggle, disabled, appearance = "circle" }: Props) {
  return <Cursor className={FRAME}>
    <Checkbox className={PICK} options={[{ value: id, label }]} value={selected ? [id] : []} onChange={onToggle} disabled={disabled} />
    <span aria-hidden="true" className={appearance === "plain" ? PLAIN_MARK : MARK} data-selected={selected}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4"><path d={selected ? "m5 12 4 4L19 6" : "M12 5v14m-7-7h14"} /></svg></span>
  </Cursor>;
}
