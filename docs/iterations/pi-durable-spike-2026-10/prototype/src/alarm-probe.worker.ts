/**
 * Step 0 of question 1, proven alone: does a SQLite Durable Object's stored alarm survive a SIGKILL of workerd and
 * restart the object in a new process, with no request? Every event goes to the object's own storage, tagged with a
 * per-instance id, so the report does not depend on anything held in memory.
 */
import { DurableObject } from "cloudflare:workers";

interface Env { readonly PROBE: DurableObjectNamespace<AlarmProbe> }

export class AlarmProbe extends DurableObject<Env> {
  readonly #instance = crypto.randomUUID();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS spike_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, instance TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL)");
    this.#record("constructed");
  }

  #record(kind: string) {
    this.ctx.storage.sql.exec("INSERT INTO spike_events (instance, kind, at) VALUES (?, ?, ?)", this.#instance, kind, Date.now());
    console.log(`[spike] alarm-probe ${kind} instance=${this.#instance}`);
  }

  override async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === "/arm") {
      this.#record("request:arm");
      const alarmAt = Date.now() + 2_000;
      await this.ctx.storage.setAlarm(alarmAt);
      return Response.json({ instance: this.#instance, alarmAt });
    }
    this.#record("request:read");
    const events = this.ctx.storage.sql.exec("SELECT seq, instance, kind, at FROM spike_events ORDER BY seq").toArray();
    return Response.json({ instance: this.#instance, alarm: await this.ctx.storage.getAlarm(), events });
  }

  override alarm(): void {
    this.#record("alarm");
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return env.PROBE.get(env.PROBE.idFromName("alarm-probe")).fetch(request);
  },
};
