import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { makeQueryClient } from "../../../src/api/query-client";
import { LocaleProvider } from "../../../src/i18n/LocaleProvider";
import { AppRouterContext } from "../_router";

/** Render a home block inside a fresh QueryClient + i18n + router (retries off). */
export function renderHome(ui: ReactElement) {
  const client = makeQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  return render(
    <AppRouterContext>
      <QueryClientProvider client={client}>
        <LocaleProvider>{ui}</LocaleProvider>
      </QueryClientProvider>
    </AppRouterContext>,
  );
}
