import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * An HTTP server a test starts on this machine's loopback interface, answering
 * every request with {@link LOOPBACK_ANSWER}: the kind of request the Node
 * pools' `fetch` guard (`test/setup/loopback-only-fetch.ts`) must let through.
 * The test that starts it closes it.
 */
export interface LoopbackServer {
  readonly url: string;
  close(): Promise<void>;
}

export const LOOPBACK_ANSWER = "loopback answered";

/** Start a server on 127.0.0.1 at a port the system picks. */
export async function startLoopbackServer(): Promise<LoopbackServer> {
  const server = createServer((_request, response) => { response.end(LOOPBACK_ANSWER); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${String(port)}/probe`, close: () => closeServer(server) };
}

/** Drop the keep-alive connection `fetch` left open, then wait for the server to close. */
async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  server.close();
  await once(server, "close");
}
