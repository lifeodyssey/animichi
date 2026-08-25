type Props = Readonly<{ id: string; label: string; description: string }>;

export function SettingsControlCopy({ id, label, description }: Props) {
  return (
    <span className="settings-control-copy">
      <strong id={`${id}-label`}>{label}</strong>
      <span id={`${id}-description`}>{description}</span>
    </span>
  );
}
