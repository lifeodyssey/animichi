// #1073 — doorbell Worker composition root (wrangler main). Wires the live
// Cloudflare Builds client bound to the request env; the OIDC verifier and
// pin reader default inside create-app. Tests import create-app directly.
import { createDoorbellApp, type Env } from "./create-app";
import { liveBuildsClient } from "./live-builds";

export { createDoorbellApp, type Env, type DoorbellDeps } from "./create-app";

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    const app = createDoorbellApp({ builds: liveBuildsClient(env) });
    return app.fetch(request, env, context);
  },
};
