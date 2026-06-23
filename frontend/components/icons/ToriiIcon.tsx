/**
 * Torii gate SVG — shared across SharedHeader, WelcomeScreen, etc.
 * Uses --color-brand token for fill.
 */
export default function ToriiIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 72 72" width={size} height={size} fill="none" aria-hidden="true">
      <rect x="12" y="16" width="48" height="5" rx="2.5" fill="var(--color-brand)" />
      <rect x="8" y="14" width="56" height="3" rx="1.5" fill="var(--color-brand)" />
      <rect x="16" y="21" width="5" height="35" rx="1" fill="var(--color-brand)" />
      <rect x="51" y="21" width="5" height="35" rx="1" fill="var(--color-brand)" />
      <rect x="12" y="30" width="48" height="3" rx="1.5" fill="var(--color-brand)" opacity=".5" />
    </svg>
  );
}
