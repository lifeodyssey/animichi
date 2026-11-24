import { once } from "node:events";
import { createServer, type AddressInfo } from "node:net";

/**
 * A Postgres URL on this machine's loopback interface whose listener counts the connections it
 * takes and drops each one unanswered: Prisma reaches it and cannot open it, so `connect()` rejects
 * with `DRIVER.CONNECTION_FAILED` at once instead of waiting out its 20-second timeout. The test
 * that starts it closes it.
 */
export interface DroppingDatabase {
  readonly url: string;
  connections(): number;
  close(): Promise<void>;
}

/** Start one on a port the system picks. */
export async function startDroppingDatabase(): Promise<DroppingDatabase> {
  let taken = 0;
  const server = createServer((socket) => { taken += 1; socket.destroy(); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  const close = async () => { server.close(); await once(server, "close"); };
  return { url: `postgresql://catalog@127.0.0.1:${String(port)}/catalog`, connections: () => taken, close };
}
