"use client";

import { use } from "react";

/**
 * MSW Provider — starts the mock service worker in development.
 * Only active when NEXT_PUBLIC_MOCK_MODE=true.
 * Renders children only after MSW is ready (prevents race conditions).
 */

const mockMode = process.env.NEXT_PUBLIC_MOCK_MODE === "true";

const mswReady: Promise<void> = mockMode
  ? import("./browser").then(({ worker }) =>
      worker.start({ onUnhandledRequest: "bypass" }).then(() => undefined),
    )
  : Promise.resolve();

export default function MSWProvider({ children }: { children: React.ReactNode }) {
  use(mswReady);
  return <>{children}</>;
}
