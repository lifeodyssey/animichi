/**
 * A database address a Worker's client can reach and never use: a loopback listener that counts the
 * connections it accepts and closes each one at once. A connection here is the evidence that a client
 * was built and tried its database. The listener belongs to the test, so no other process made it.
 */
import { createServer, type AddressInfo } from "node:net";

export interface ConnectionWitness {
  /** The URL a native client is given for the listener. */
  readonly dsn: string;
  connections(): number;
  close(): Promise<void>;
}

export async function startConnectionWitness(): Promise<ConnectionWitness> {
  let accepted = 0;
  const server = createServer((socket) => { accepted += 1; socket.destroy(); });
  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
  const { port } = server.address() as AddressInfo;
  return {
    dsn: `postgres://first-use:first-use@127.0.0.1:${String(port)}/first-use`,
    connections: () => accepted,
    close: () => new Promise<void>((resolve) => { server.close(() => { resolve(); }); }),
  };
}
