import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * Unmount every rendered tree between cases.
 *
 * `globals` is off in `vitest.config.ts`, so `@testing-library/react` never sees
 * a global `afterEach` to register its own auto-cleanup against: without this,
 * each `render()` stays in the document for the rest of the file and `screen`
 * queries can match a previous case's DOM. That is not hypothetical — the cold
 * client leg of `api/hydration-no-double-fetch` was resolving against the
 * hydrated leg's leftover `<p>Uji × Euphonium</p>` and passing while its own
 * query had not even been issued.
 */
afterEach(cleanup);
