import type { AnimeScene } from "@animichi/contract";
import { SectionHead } from "./SectionHead";
import type { AnimeCopy } from "./copy";

type Props = Readonly<{ scenes: readonly AnimeScene[]; copy: AnimeCopy }>;

type ItemProps = Readonly<{ scene: AnimeScene; copy: AnimeCopy; rank: number }>;

/** Only real http(s) URLs may hit `<img src>`: `src=""` requests the page itself. */
function hasRenderableShot(url: string | null): url is string {
  if (url === null || !URL.canParse(url)) return false;
  const protocol = new URL(url).protocol;
  return protocol === "https:" || protocol === "http:";
}

function SceneShotPlaceholder({ scene }: Readonly<{ scene: AnimeScene }>) {
  return <div role="img" aria-label={scene.name} className="anime-scene__shot" />;
}

function SceneImage({ url, name }: Readonly<{ url: string; name: string }>) {
  return <img src={url} alt={name} loading="lazy" className="anime-scene__shot" />;
}

function SceneShot({ scene }: Readonly<{ scene: AnimeScene }>) {
  const url = scene.screenshot_url;
  if (!hasRenderableShot(url)) return <SceneShotPlaceholder scene={scene} />;
  return <SceneImage url={url} name={scene.name} />;
}

function sceneMeta(scene: AnimeScene, copy: AnimeCopy): string {
  const suffix = scene.city ? ` · ${scene.city}` : "";
  return `${copy.shotCountFact(scene.shot_count)}${suffix}`;
}

/** Canvas rank marker: the top three wear the gold tint, the rest stay plain. */
const TOP_RANKS = 3;

function rankToneClass(rank: number): string {
  return rank <= TOP_RANKS ? "anime-pill--gold" : "anime-pill--plain";
}

function SceneHeading({ scene, rank }: Readonly<{ scene: AnimeScene; rank: number }>) {
  return (
    <div className="anime-scene__head">
      <span className={`anime-pill ${rankToneClass(rank)}`}>{String(rank)}</span>
      <p className="anime-scene__name">{scene.name}</p>
    </div>
  );
}

function SceneItem({ scene, copy, rank }: ItemProps) {
  return (
    <li className="anime-card anime-scene">
      <SceneShot scene={scene} />
      <SceneHeading scene={scene} rank={rank} />
      <p className="anime-scene__meta">{sceneMeta(scene, copy)}</p>
    </li>
  );
}

/** 名場面 ranking: an ordered list, most-shot scene first. */
export function ScenesSection({ scenes, copy }: Props) {
  return (
    <section aria-labelledby="anime-scenes" className="anime-section">
      <SectionHead id="anime-scenes" label={copy.scenesHeading} />
      <ol className="anime-scenes">
        {scenes.map((scene, i) => <SceneItem key={scene.id} scene={scene} copy={copy} rank={i + 1} />)}
      </ol>
    </section>
  );
}
