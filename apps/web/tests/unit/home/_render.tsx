import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { makeQueryClient } from "../../../src/api/query-client";
import { LocaleProvider } from "../../../src/i18n/context";

/** Render a home block inside a fresh QueryClient + i18n provider (retries off). */
export function renderHome(ui: ReactElement) {
  const client = makeQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>{ui}</LocaleProvider>
    </QueryClientProvider>,
  );
}
