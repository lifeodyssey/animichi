import type { LaneSnapshot } from '@earendil-works/pi-agent-core';

export interface NativeTaskInput {
  readonly prompt: string;
  readonly locale: string;
}

export type NativeCaseMetadata = Readonly<Record<string, unknown>>;

export type NativeOutput = LaneSnapshot;
