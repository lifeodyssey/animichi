/** Torii gate glyph — brand mark for the header, eyebrow, and footer. */
export function ToriiMark({ size = 18 }: { size?: number }) {
  return (<svg className="torii-mark" viewBox="0 0 72 72" width={size} height={size} fill="none" aria-hidden="true">
      <rect x="8" y="12" width="56" height="7" rx="3.5" fill="currentColor" />
      <rect x="14" y="22" width="44" height="4" rx="2" fill="currentColor" />
      <rect x="18" y="26" width="6" height="34" rx="2" fill="currentColor" />
      <rect x="48" y="26" width="6" height="34" rx="2" fill="currentColor" />
      <rect x="33" y="26" width="6" height="10" rx="2" fill="currentColor" />
  </svg>);
}
