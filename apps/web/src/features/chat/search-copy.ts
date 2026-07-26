import type { SpotCluster } from "../../lib/chat/spotClusters";
import type { ChatDict } from "./i18n";

/** Cluster display name: the majority city, else a localized area fallback. */
export function clusterName(cluster: SpotCluster, index: number, dict: ChatDict): string {
  return cluster.city ?? dict.search.areaFallback.replace("{n}", String(index + 1));
}

/** Localized spot-count badge for a cluster bubble (C3b). */
export function spotCountBadge(count: number, dict: ChatDict): string {
  return dict.search.spotCount.replace("{count}", String(count));
}

/** Localized episode tag for a spot card (C3a); undefined when unknown. */
export function episodeTag(dict: ChatDict, ep?: number): string | undefined {
  if (ep === undefined) return undefined;
  return dict.errorStates.d9Episode.replace("{ep}", String(ep));
}
