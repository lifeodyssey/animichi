import type { SpotRow } from "./Cards";
import type { ChatDict } from "../i18n";
import { SceneThumb } from "./ErrorStates/SceneThumb";

function episodeOf(scene: SpotRow): number | undefined {
  const episode = scene.ep ?? scene.episode;
  return episode !== undefined && episode >= 0 ? episode : undefined;
}

/** Same box as the screenshot thumb so stop names stay aligned without art. */
function ScenePlaceholder() {
  return (
    <span className="grid h-14 w-[5.5rem] flex-none place-items-center rounded-xl bg-muted" aria-hidden="true">
      <svg viewBox="0 0 24 24" className="size-5 text-primary" fill="currentColor">
        <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10z" />
      </svg>
    </span>
  );
}

export function RouteStopScene({ scene, dict }: Readonly<{ scene?: SpotRow; dict: ChatDict }>) {
  if (!scene?.screenshot_url) return <ScenePlaceholder />;
  return (
    <span className="flex-none [&>.chat-scene-thumb]:h-14! [&>.chat-scene-thumb]:w-[5.5rem]!">
      <SceneThumb src={scene.screenshot_url} alt={scene.name ?? ""} ep={episodeOf(scene)} dict={dict} />
    </span>
  );
}
