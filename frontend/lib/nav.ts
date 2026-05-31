import type { Dict } from "./i18n";

export interface AppNavItem {
  key: keyof Dict["app_nav"] & ("map" | "spots" | "records" | "collection");
  href: string;
}

/**
 * Single source of truth for the authenticated-app nav (states 05/08/10/14/15).
 * Labels come from the dict to support ja/en/zh localisation.
 */
export const APP_NAV_ITEMS: readonly AppNavItem[] = [
  { key: "map", href: "/chat" },
  { key: "spots", href: "/search" },
  { key: "records", href: "/history" },
  { key: "collection", href: "/collection" },
] as const;

/** Returns true when `pathname` starts with `href` (prefix match, safe for unknowns). */
export function isNavActive(pathname: string, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}
