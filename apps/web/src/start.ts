import { createStart, createCsrfMiddleware } from "@tanstack/react-start";
import { cspMiddleware } from "./server/csp-middleware";

/**
 * The app's global request middleware.
 *
 * Adding this entry replaces the framework's built-in default request
 * middleware — `createStartHandler` reads ours instead of falling back to its
 * own — so the CSRF middleware has to be restated here. It is the same
 * configuration the framework applies when this file is absent
 * (`createCsrfMiddleware({ filter: ctx => ctx.handlerType === "serverFn" })`),
 * and leaving it out would silently drop cross-site protection from server
 * functions.
 */
const csrfMiddleware = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" });

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, cspMiddleware],
}));
