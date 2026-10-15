import { describe, expect, it } from "vitest";
import { budgetKeyFor, bundleBudgets, isOverBudget } from "../../bundle-budget.config";

/**
 * SUT: the chunk-family lookup in `bundle-budget.config.ts`. The map tile
 * worker (`maplibre-gl-worker-*.js`) and the vendor bundle (`maplibre-gl-*.js`)
 * share the `maplibre-gl-` prefix, so the lookup's declaration order decides
 * which ceiling a worker chunk is held to (#1570): the worker's own entry, not
 * the vendor budget it used to inherit.
 */
describe("bundle-budget.config.ts", () => {
  it("resolves the map tile worker before the maplibre-gl vendor family it prefixes", () => {
    expect(budgetKeyFor("maplibre-gl-worker-CNLXcz58.js")).toBe("maplibre-gl-worker");
    expect(budgetKeyFor("maplibre-gl-Bj1T2umq.js")).toBe("maplibre-gl");
  });

  it("holds the worker chunk to the worker ceiling, not the vendor ceiling", () => {
    const workerChunk = "maplibre-gl-worker-CNLXcz58.js";
    const betweenCeilings = bundleBudgets["maplibre-gl"];
    expect(bundleBudgets["maplibre-gl-worker"]).toBeLessThan(bundleBudgets["maplibre-gl"]);
    expect(isOverBudget(workerChunk, betweenCeilings)).toBe(true);
    expect(isOverBudget("maplibre-gl-Bj1T2umq.js", betweenCeilings)).toBe(false);
  });

  it("leaves a chunk no family budgets unbudgeted", () => {
    expect(budgetKeyFor("chat-BGbQzvwY.js")).toBe("chat");
    expect(budgetKeyFor("index-BOuNCoNs.js")).toBeNull();
  });
});
