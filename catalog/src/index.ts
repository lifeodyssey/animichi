import { Hono } from "hono";
import { RPCHandler } from "@orpc/server/fetch";
import { catalogRouter } from "./router";

export interface Env {
  ENVIRONMENT?: string;
}

const app = new Hono<{ Bindings: Env }>();

app.get("/healthz", (c) =>
  c.json({ status: "ok", service: "catalog", env: c.env?.ENVIRONMENT ?? "unknown" }),
);

const rpcHandler = new RPCHandler(catalogRouter);

// Mount the oRPC router under /catalog/* (search / spots / nearby / route).
// This matches the path convention in packages/contract (/catalog/<method>)
// and the Python client (CatalogClient._rpc).
app.use("/catalog/*", async (c, next) => {
  const { matched, response } = await rpcHandler.handle(c.req.raw, {
    prefix: "/catalog",
    context: {},
  });
  if (matched) {
    return c.newResponse(response.body, response);
  }
  await next();
});

export default app;
export { catalogRouter };
export type { CatalogRouter } from "./router";
