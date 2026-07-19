const FOX_IMAGES = {
  guide: "/images/chat/fox-guide.webp",
  thinking: "/images/chat/fox-thinking.webp",
} as const;

export type FoxPose = keyof typeof FOX_IMAGES;

type Props = Readonly<{ pose: FoxPose; alt: string }>;

/** Animichi fox avatar (design spec §2: V2 fox-persona legacy). */
export function FoxAvatar({ pose, alt }: Props) {
  return (
    <img className="chat-fox-avatar" src={FOX_IMAGES[pose]} alt={alt} width={40} height={40} />
  );
}
