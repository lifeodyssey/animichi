import type { AnimeScene } from "@seichijunrei/contract";
import type { AnimeCopy } from "./copy";

type Props = Readonly<{ scenes: readonly AnimeScene[]; copy: AnimeCopy }>;

type ItemProps = Readonly<{ scene: AnimeScene; copy: AnimeCopy }>;

/** Only real http(s) URLs may hit `<img src>`: `src=""` requests the page itself. */
function hasRenderableShot(url: string): boolean {
  if (!URL.canParse(url)) return false;
  const protocol = new URL(url).protocol;
  return protocol === "https:" || protocol === "http:";
}

function SceneShotPlaceholder({ scene }: Readonly<{ scene: AnimeScene }>) {
  return (
    <div
      role="img"
      aria-label={scene.name}
      className="aspect-video w-full rounded-lg bg-[var(--color-muted)]"
    />
  );
}

function SceneImage({ scene }: Readonly<{ scene: AnimeScene }>) {
  return (
    <img
      src={scene.screenshot_url}
      alt={scene.name}
      loading="lazy"
      className="aspect-video w-full rounded-lg object-cover"
    />
  );
}

function SceneShot({ scene }: Readonly<{ scene: AnimeScene }>) {
  if (!hasRenderableShot(scene.screenshot_url)) return <SceneShotPlaceholder scene={scene} />;
  return <SceneImage scene={scene} />;
}

function sceneMeta({ scene, copy }: ItemProps): string {
  const suffix = scene.city ? ` · ${scene.city}` : "";
  return `${copy.shotCountFact(scene.shot_count)}${suffix}`;
}

function SceneItem({ scene, copy }: ItemProps) {
  return (
    <li className="rounded-xl bg-[var(--color-card)] p-2">
      <SceneShot scene={scene} />
      <p className="mb-0 font-bold">{scene.name}</p>
      <p className="my-0 text-sm text-[var(--color-muted-fg)]">{sceneMeta({ scene, copy })}</p>
    </li>
  );
}

/** 名場面 ranking: an ordered list, most-shot scene first. */
export function ScenesSection({ scenes, copy }: Props) {
  return (
    <section aria-labelledby="anime-scenes">
      <h2 id="anime-scenes" className="text-lg">{copy.scenesHeading}</h2>
      <ol className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
        {scenes.map((scene) => <SceneItem key={scene.id} scene={scene} copy={copy} />)}
      </ol>
    </section>
  );
}
