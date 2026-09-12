const paths = {
  photos: "M4 4h16v16H4z M4 15l5-5 5 5 3-3 3 3 M15 8h.01",
  next: "m9 5 7 7-7 7", back: "m15 5-7 7 7 7",
} as const;

export function SceneIcon({ name }: Readonly<{ name: keyof typeof paths }>) {
  return <svg aria-hidden="true" className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}
