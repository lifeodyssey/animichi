import { useDict } from "../../i18n/context";
import { useTheme } from "./useTheme";

/** Day/night switch — persistence lives in useTheme. */
export function DayNightToggle() {
  const landing = useDict().landing;
  const { theme, toggle } = useTheme();
  const isNight = theme === "night";
  const label = isNight ? landing.theme_night : landing.theme_day;
  return (
    <button type="button" className="day-night-toggle" role="switch" aria-checked={isNight} aria-label={label} onClick={toggle}>{label}</button>
  );
}
