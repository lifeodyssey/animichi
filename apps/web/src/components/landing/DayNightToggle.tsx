import { useDict } from "../../i18n/LocaleProvider";
import type { Theme } from "../../features/config/lib/theme-storage";
import { useTheme } from "./use-theme";

interface ModeButtonProps {
  mode: Theme;
  label: string;
  active: boolean;
  onPick: (mode: Theme) => void;
}

function ModeButton({ mode, label, active, onPick }: ModeButtonProps) {
  return (
    <button type="button" aria-pressed={active} onClick={() => { onPick(mode); }}>{label}</button>
  );
}

/** Fixed bottom-right day/night pair — persistence lives in useTheme. */
export function DayNightToggle() {
  const landing = useDict().landing;
  const { theme, set } = useTheme();
  return (
    <div className="day-night-toggle">
      <ModeButton mode="day" label={landing.theme_day} active={theme === "day"} onPick={set} />
      <ModeButton mode="night" label={landing.theme_night} active={theme === "night"} onPick={set} />
    </div>
  );
}
