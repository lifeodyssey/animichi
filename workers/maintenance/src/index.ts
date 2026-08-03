import { connectDatabase } from "./database";
import {
  purgeAnonQuotaCounts,
  purgeAnonymousSessions,
  type DatabaseClient,
} from "./purge";

export const ANONYMOUS_SESSIONS_CRON = "37 18 * * *";
export const ANON_QUOTA_CRON = "37 19 * * *";

interface ScheduledInput {
  readonly cron: string;
}

export interface MaintenanceEnv {
  readonly AGENT_DATABASE_URL: string;
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

function databaseUrl(env: ScheduledEnvironment): string {
  const value = env.AGENT_DATABASE_URL;
  if (!value) throw new Error("Missing required binding: AGENT_DATABASE_URL");
  return value;
}

async function runCron(cron: string, db: DatabaseClient, now: Date): Promise<void> {
  if (cron === ANON_QUOTA_CRON) await purgeAnonQuotaCounts(db, now);
  else if (cron === ANONYMOUS_SESSIONS_CRON) await purgeAnonymousSessions(db, now);
  else throw new Error(`Unknown maintenance cron: ${cron}`);
}

export function createScheduledHandler(
  dependencies: HandlerDependencies = DEFAULT_DEPENDENCIES,
): ScheduledHandler {
  return async (controller, env) => {
    const db = dependencies.connect(databaseUrl(env));
    await runCron(controller.cron, db, dependencies.now());
  };
}

export default {
  scheduled: createScheduledHandler(),
} satisfies ExportedHandler<MaintenanceEnv>;
