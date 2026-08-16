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

export interface BuildsClient {
  start(input: StartBuildInput): Promise<BuildHandle>;
  status(buildId: string): Promise<BuildStatus>;
}
