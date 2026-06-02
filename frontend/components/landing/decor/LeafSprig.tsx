import { cn } from "@/lib/utils";

interface LeafSprigProps {
  size?: number;
  /** Mirror horizontally so it can hug either edge. */
  flip?: boolean;
  className?: string;
}

/**
 * A two-leaf botanical sprig. Hand-drawn curve, soft sage fill. Used sparingly
 * beside section kickers and card corners to carry the Yuru Camp outdoorsiness.
 */
export default function LeafSprig({ size = 28, flip = false, className }: LeafSprigProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={cn("select-none", className)}
      style={flip ? { transform: "scaleX(-1)" } : undefined}
    >
      <path
        d="M6 28 C9 20, 13 13, 24 6"
        stroke="#7fae6b"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M14 15 C10 12, 9 7, 13 4 C17 7, 17 13, 14 15 Z"
        fill="#9cc384"
        stroke="#7fae6b"
        strokeWidth="1"
      />
      <path
        d="M17 20 C20 18, 25 18, 27 22 C24 25, 18 24, 17 20 Z"
        fill="#b6d49e"
        stroke="#7fae6b"
        strokeWidth="1"
      />
    </svg>
  );
}
