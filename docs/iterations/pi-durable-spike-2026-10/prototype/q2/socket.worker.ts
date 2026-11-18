/**
 * Way 11 for sockets. The outbound guard is a `fetch` handler, so it cannot see a TCP socket. `/connect?host=…&port=…`
 * opens one from inside workerd with `cloudflare:sockets` and reports whether it opened, how long that took on the
 * worker's clock, and the error text when it did not. The runner sends a loopback address it listens on, then
 * 192.0.2.1 (TEST-NET-1, a documentation address that is never routed).
 */
import { connect } from "cloudflare:sockets";

const OPEN_TIMEOUT_MS = 5_000;

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const hostname = url.searchParams.get("host") ?? "";
    const port = Number(url.searchParams.get("port"));
    const started = Date.now();
    try {
      const socket = connect({ hostname, port });
      socket.closed.catch(() => undefined);
      const timedOut = new Promise<"timed-out">((resolve) => setTimeout(() => resolve("timed-out"), OPEN_TIMEOUT_MS));
      const opened = await Promise.race([socket.opened, timedOut]);
      const elapsedMs = Date.now() - started;
      if (opened === "timed-out") return Response.json({ hostname, port, outcome: "timed-out", elapsedMs });
      await socket.close();
      return Response.json({ hostname, port, outcome: "opened", elapsedMs, remoteAddress: opened.remoteAddress ?? null });
    } catch (error) {
      return Response.json({ hostname, port, outcome: "refused", elapsedMs: Date.now() - started,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
    }
  },
};
