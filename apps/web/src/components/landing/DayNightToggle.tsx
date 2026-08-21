import { useDict } from "../../i18n/LocaleProvider";
import { useTheme } from "./use-theme";

/** Sun disc with eight rays — the day face of the switch. Decorative: the
 * button itself carries the accessible name. */
function SunDisc() {
  return (
    <svg data-glyph="sun" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="4.6" />
      <path d="M12 1.8v2.6M12 19.6v2.6M1.8 12h2.6M19.6 12h2.6M4.9 4.9l1.9 1.9M17.2 17.2l1.9 1.9M19.1 4.9l-1.9 1.9M6.8 17.2l-1.9 1.9" />
    </svg>
  );
}

/** Waxing crescent — the night face of the switch. Decorative, as above. */
function MoonCrescent() {
  return (
    <svg data-glyph="moon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M20.2 14.4A8.6 8.6 0 0 1 9.6 3.8a8.6 8.6 0 1 0 10.6 10.6Z" />
    </svg>
  );
}

/** Fixed bottom-right circular day/night switch: the face shows the mode in
 * force, `aria-checked` reports night, and persistence lives in `useTheme`. */
export function DayNightToggle() {
  const landing = useDict().landing;
  const { theme, set } = useTheme();
  const isNight = theme === "night";
  return <button type="button" className="day-night-toggle" role="switch" aria-checked={isNight}
    aria-label={isNight ? landing.theme_night : landing.theme_day}
    onClick={() => { set(isNight ? "day" : "night"); }}>
    {isNight ? <MoonCrescent /> : <SunDisc />}
  </button>;
}
