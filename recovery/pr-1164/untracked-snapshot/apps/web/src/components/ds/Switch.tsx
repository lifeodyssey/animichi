/**
 * Animal Island `Switch` (docs/design/animal-island-ref/component-specs.md
 * §Switch): 52x28 track, 21x21 handle floating `translateY(-2px)`, green when
 * ON. The visible label sits inside the control, so the accessible NAME is a
 * stable noun ("night mode") and the STATE travels on `aria-checked` — never
 * on the colour alone, and never by renaming the control (WCAG 4.1.2).
 *
 * Emil Kowalski's rule for settings-class controls: the feedback is the state
 * change itself, so the handle gets a 160ms ease-out translate and a press
 * scale, nothing spring-loaded. The motion lives in `globals.css` behind the
 * reduced-motion guard.
 */
type SwitchProps = Readonly<{
  /** The accessible name AND the visible label — one string, one meaning. */
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}>;

/** The 52x28 track with its floating knob; purely decorative, the button
 * carries the name, the role and the state. */
function SwitchTrack() {
  return (
    <span className="ds-switch__track" aria-hidden="true"><span className="ds-switch__handle" /></span>
  );
}

export function Switch({ label, checked, onChange }: SwitchProps) {
  const toggle = () => { onChange(!checked); };
  return (
    <button type="button" role="switch" aria-checked={checked} className="ds-switch" onClick={toggle}>
      <span className="ds-switch__label">{label}</span>
      <SwitchTrack />
    </button>
  );
}
