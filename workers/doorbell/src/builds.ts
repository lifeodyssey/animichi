export interface StartBuildInput {
  triggerId: string;
  commit: string;
}

export interface BuildHandle {
  buildId: string;
}

export interface BuildStatus {
  id: string;
  status: string;
  outcome?: string;
}

export type BuildsFailureStage = "secret_read" | "fetch" | "non_2xx" | "bad_envelope";

export class BuildsApiError extends Error {
  readonly stage: BuildsFailureStage;
  readonly status: number | undefined;
  readonly code: number | undefined;

  constructor(stage: BuildsFailureStage, status?: number, code?: number) {
    super("builds api unavailable");
    this.name = "BuildsApiError";
    this.stage = stage;
    this.status = status;
    this.code = code;
  }
}

export interface BuildsClient {
  start(input: StartBuildInput): Promise<BuildHandle>;
  status(buildId: string): Promise<BuildStatus>;
}
