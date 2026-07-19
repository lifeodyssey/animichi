/**
 * @vitest-environment jsdom
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { CatalogSearchResults } from "../../../src/components/CatalogSearchResults";
import { makeQueryClient } from "../../../src/api/query-client";
import { server } from "../../msw/node";
import { catalogUpstreamErrorHandler } from "../../msw/handlers";

function renderWithClient(node: ReactNode) {
  const client = makeQueryClient();
  // Disable retries so a failing query settles immediately in the test.
  client.setDefaultOptions({ queries: { retry: false } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe("CatalogSearchResults end-to-end", () => {
  it("renders points returned by the catalog.search query", async () => {
    renderWithClient(<CatalogSearchResults query="hakone" />);
    expect(await screen.findByText("Hakone-Yumoto Station")).toBeTruthy();
  });

  it("shows the loading state before the query resolves", () => {
    renderWithClient(<CatalogSearchResults query="hakone" />);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("surfaces a failed search as an alert", async () => {
    server.use(catalogUpstreamErrorHandler);
    renderWithClient(<CatalogSearchResults query="hakone" />);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
