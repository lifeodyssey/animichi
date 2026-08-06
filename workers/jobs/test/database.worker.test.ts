import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ neon: vi.fn(), query: vi.fn() }));

vi.mock("@neondatabase/serverless", () => ({ neon: mocks.neon }));

import { connectDatabase } from "../src/database";

beforeEach(() => {
  mocks.neon.mockReset();
  mocks.query.mockReset();
  mocks.neon.mockReturnValue({ query: mocks.query });
});

describe("Neon database adapter", () => {
  it("uses full results and forwards parameterized queries", async () => {
    mocks.query.mockResolvedValue({ rowCount: 2, rows: [{ session_id: "sess-a" }] });
    const db = connectDatabase("postgresql://agent.example/animichi");

    await expect(db.query("DELETE FROM example WHERE id = $1", ["id-a"])).resolves.toEqual({
      rowCount: 2,
      rows: [{ session_id: "sess-a" }],
    });

    expect(mocks.neon).toHaveBeenCalledWith(
      "postgresql://agent.example/animichi",
      { fullResults: true },
    );
    expect(mocks.query).toHaveBeenCalledWith("DELETE FROM example WHERE id = $1", ["id-a"]);
  });
});
