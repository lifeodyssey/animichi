import { QueueLock } from "../../src/lock";
import { migrateSelected, preflightSelected } from "../../src/selected-migration";
import { makeApp, testEnv } from "../migrate.worker.helpers";
import { preflightRequest } from "../preflight-fixtures";
import { MIGRATIONS, requestMetadata } from "../sealed-migrations";

export { APP_MIGRATION_COUNT, BASELINE_OPERATION_COUNT, MIGRATIONS, requestMetadata, TARGET } from "../sealed-migrations";

export async function nativeApp(dsn: string, directory = MIGRATIONS) {
  const lock = new QueueLock();
  const { app, token } = await makeApp({ migrationsDir: directory,
    selected: {
      preflight: (connection, metadata) => lock.runExclusive(() => preflightSelected(connection, metadata, directory)),
      migrate: (connection, metadata) => lock.runExclusive(() => migrateSelected(connection, metadata, directory)),
    },
  });
  const env = { ...testEnv(), MIGRATOR_DATABASE_URL: dsn };
  return {
    preview: () => app.request(preflightRequest(requestMetadata, token), {}, env),
    migrate: () => app.request(new Request("https://migrator.test/migrate", {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(requestMetadata),
    }), {}, env),
  };
}
