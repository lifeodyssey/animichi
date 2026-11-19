import { createConnection, type Socket } from "node:net";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { RedisTcpCeilingStore, type StoreSocket } from "../src/redis-tcp-ceiling-store.ts";
import type { ScriptClock } from "../src/rolling-window-script.ts";
import { connectedWithin } from "../src/start-egress-server.ts";
import { UpstreamRequestCeiling, type CeilingDecision } from "../src/upstream-ceiling.ts";

/**
 * The ceiling over a REAL Redis, started by Testcontainers: the one place the
 * window's script runs as written, because the RESP stubs of the unit suites
 * can only answer what a test tells them to. It builds the container, the
 * production store over it, and a ceiling whose clock the test owns.
 *
 * The store is dialled by this file's own connection, not the composition
 * root's: that one dials `family: 6` because Fly's private network is IPv6, and
 * a container's published port need not be. The composition root's dial keeps
 * its own proof over `::1` in `ceiling-store.integration.test.ts`.
 */

/** The image, by the digest of its multi-arch index: the latest stable Redis when this was written. */
export const REDIS_IMAGE =
  "redis:8.10.3-alpine@sha256:7958cfbb9d152f87dadfbc89f1b0b15938f0b81ff8982feb327476f4911935c3";

/** An hour boundary, in the egress's seconds: 1699999200 is 472222 whole hours. */
export const HOUR = 1_699_999_200;

/**
 * The test's clock, injected as the window's prologue: `now` is the argument
 * after the body's own three, which the store sends from the ceiling's clock.
 * The service runs the same body on `STORE_CLOCK`, the store's own `TIME`.
 */
export const ARGUMENT_CLOCK: ScriptClock = {
  prologue: "local now = tonumber(ARGV[4])\n",
  argumentsAt: (nowSeconds) => [String(nowSeconds)],
};

/** The second a ceiling built here reads, which the test moves. */
export interface TestClock {
  now: number;
}

/** A Redis of this test's own, accepting connections. */
export function startRedis(): Promise<StartedTestContainer> {
  return new GenericContainer(REDIS_IMAGE)
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
}

/** The production store over `container`, running the window on the test's clock. */
export function storeOn(container: StartedTestContainer): RedisTcpCeilingStore {
  return new RedisTcpCeilingStore({ url: urlOf(container), connect: dial, clock: ARGUMENT_CLOCK });
}

/** The store exactly as the service builds it: on its default clock, the store's own `TIME`. */
export function serviceStoreOn(container: StartedTestContainer): RedisTcpCeilingStore {
  return new RedisTcpCeilingStore({ url: urlOf(container), connect: dial });
}

/** The address of the container's published port, with no credential: the test's Redis requires none. */
function urlOf(container: StartedTestContainer): string {
  return `redis://${container.getHost()}:${String(container.getMappedPort(6379))}`;
}

/** A ceiling of `limit` over the store on `container`, reading `clock`. */
export function ceilingOn(container: StartedTestContainer, limit: number, clock: TestClock): UpstreamRequestCeiling {
  return new UpstreamRequestCeiling(limit, storeOn(container), () => undefined, () => clock.now);
}

/** Ask `ceiling` once at each second of `seconds`, in order, and collect what it decided. */
export async function decisionsAt(ceiling: UpstreamRequestCeiling, clock: TestClock, seconds: readonly number[]): Promise<CeilingDecision[]> {
  const decisions: CeilingDecision[] = [];
  for (const second of seconds) {
    clock.now = second;
    decisions.push(await ceiling.tryAcquire());
  }
  return decisions;
}

/** Run `redis-cli` inside the container: how a test seeds, inspects and resets the store without a client of its own. */
export async function redisCli(container: StartedTestContainer, ...args: string[]): Promise<string> {
  const result = await container.exec(["redis-cli", ...args]);
  return result.output.trim();
}

/** This file's dial: a plain TCP connection to the published port, held to the store's own deadline. */
function dial(url: string): Promise<StoreSocket> {
  const address = new URL(url);
  return connectedWithin(createConnection({ host: address.hostname, port: Number(address.port) })).then(storeSocketOf);
}

/** A `net.Socket`, reduced to the five things the store's injected seam uses. */
function storeSocketOf(socket: Socket): StoreSocket {
  return {
    write: (data) => socket.write(data),
    destroy: () => socket.destroy(),
    onData: (listener) => socket.on("data", listener),
    onError: (listener) => socket.on("error", listener),
    onClose: (listener) => socket.on("close", listener),
  };
}
