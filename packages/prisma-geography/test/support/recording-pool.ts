import type pg from "pg";

export interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

export class QueryLog {
  readonly recorded: RecordedQuery[] = [];

  record(text: string, values: readonly unknown[]): void {
    this.recorded.push({ text, values });
  }

  lastMatching(needle: string): RecordedQuery {
    const found = [...this.recorded].reverse().find((query) => query.text.includes(needle));
    if (found === undefined) throw new Error(`no recorded statement contains ${needle}`);
    return found;
  }
}

export function recordingPool(pool: pg.Pool, log: QueryLog): pg.Pool {
  return new Proxy(pool, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (property !== "connect" || typeof value !== "function") return bind(value, target);
      return async () => recordingClient(await target.connect(), log);
    },
  });
}

function recordingClient(client: pg.PoolClient, log: QueryLog): pg.PoolClient {
  return new Proxy(client, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (property !== "query" || typeof value !== "function") return bind(value, target);
      return (...args: unknown[]) => invokeQuery(value, target, args, log);
    },
  });
}

function bind(value: unknown, target: object): unknown {
  return typeof value === "function" ? value.bind(target) : value;
}

function invokeQuery(value: CallableFunction, target: pg.PoolClient, args: unknown[], log: QueryLog): unknown {
  log.record(...statementOf(args));
  return Reflect.apply(value, target, args);
}

function statementOf(args: readonly unknown[]): [string, readonly unknown[]] {
  const [first, second] = args;
  if (typeof first === "string") return [first, Array.isArray(second) ? second : []];
  if (isQueryConfig(first)) return [first.text, Array.isArray(first.values) ? first.values : []];
  return ["", []];
}

function isQueryConfig(value: unknown): value is { readonly text: string; readonly values?: unknown } {
  return typeof value === "object" && value !== null && "text" in value && typeof value.text === "string";
}
