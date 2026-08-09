import { connectDatabase } from "./database";
import {
  purgeAnonQuotaCounts,
  purgeAnonymousSessions,
  type DatabaseClient,
} from "./purge";

import { ANONYMOUS_SESSIONS_CRON, ANON_QUOTA_CRON } from "./schedule";

interface ScheduledInput {
  readonly cron: string;
}

export interface MaintenanceEnv {
  /** Staging supplies the DSN as a Secrets Store binding (#912 PR2). */
  readonly AGENT_DATABASE_URL: string | SecretsStoreSecret;
}

type ScheduledEnvironment = Partial<MaintenanceEnv>;
type ScheduledHandler = (controller: ScheduledInput, env: ScheduledEnvironment) => Promise<void>;

export interface HandlerDependencies {
  connect: (connectionString: string) => DatabaseClient;
  now: () => Date;
}

const DEFAULT_DEPENDENCIES: HandlerDependencies = {
  connect: connectDatabase,
  now: () => new Date(),
};

async function databaseUrl(env: ScheduledEnvironment): Promise<string> {
  const value = env.AGENT_DATABASE_URL;
  if (!value) throw new Error("Missing required binding: AGENT_DATABASE_URL");
  return typeof value === "string" ? value : await value.get();
}

async function runCron(cron: string, db: DatabaseClient, now: Date): Promise<void> {
  if (cron === ANON_QUOTA_CRON) await purgeAnonQuotaCounts(db, now);
  else if (cron === ANONYMOUS_SESSIONS_CRON) await purgeAnonymousSessions(db, now);
  else throw new Error(`Unknown jobs cron: ${cron}`);
}

export function createScheduledHandler(
  dependencies: HandlerDependencies = DEFAULT_DEPENDENCIES,
): ScheduledHandler {
  return async (controller, env) => {
    const db = dependencies.connect(await databaseUrl(env));
    await runCron(controller.cron, db, dependencies.now());
  };
}

export default {
  scheduled: createScheduledHandler(),
} satisfies ExportedHandler<MaintenanceEnv>;
