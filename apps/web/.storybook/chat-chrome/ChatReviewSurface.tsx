import type { CSSProperties, ReactNode } from "react";

type Props = Readonly<{ title: string; viewport: unknown; children: ReactNode }>;

const CHAT_GROUND: CSSProperties = {
  backgroundColor: "var(--color-ground)",
  backgroundImage: "var(--leaf-tile-image)",
  backgroundSize: "180px",
};

function widthOf(viewport: unknown): CSSProperties["width"] {
  if (viewport === "narrow") return "min(375px, 100%)";
  if (viewport === "full") return "100%";
  if (viewport === "component-narrow") return "min(375px, 100%)";
  if (viewport === "component") return "min(500px, 100%)";
  return "min(760px, 100%)";
}

export function ChatReviewSurface({ title, viewport, children }: Props) {
  if (!title.startsWith("Chat/")) return children;
  const style = { ...CHAT_GROUND, width: widthOf(viewport), minHeight: "240px", padding: "24px", ...componentGround(viewport) };
  return <div style={style}>{children}</div>;
}

function componentGround(viewport: unknown): CSSProperties {
  if (viewport === "component-appbar") return { width: "min(420px, 100%)", minHeight: 0, padding: 0, borderRadius: "16px", backgroundImage: "none" };
  if (viewport !== "component" && viewport !== "component-narrow") return {};
  return { backgroundColor: "var(--color-paper)", backgroundImage: "none" };
}
