import { describe, expect, it } from "vitest";
import { parseAnitabiPoints } from "../src/enrich/parse";

const BASE = {
  id: "al3yeri",
  name: "宇治橋",
  geo: [34.8915, 135.8078],
  image: "/2024/uji.jpg",
};

describe("parseAnitabiPoints origin mapping", () => {
  it("stores origin and originURL from the upstream payload", () => {
    const [row] = parseAnitabiPoints("10380", [{
      ...BASE,
      origin: "バンダイチャンネル",
      originURL: "https://www.b-ch.com/ttl/index.php?ttl_c=1",
    }]);
    expect(row?.origin).toBe("バンダイチャンネル");
    expect(row?.origin_url).toBe("https://www.b-ch.com/ttl/index.php?ttl_c=1");
  });

  it("reads origin_url when the payload uses the snake_case key", () => {
    const [row] = parseAnitabiPoints("10380", [{
      ...BASE,
      origin: "Anitabi",
      origin_url: "https://anitabi.cn/map",
    }]);
    expect(row?.origin_url).toBe("https://anitabi.cn/map");
  });

  it("stores null when the payload omits origin fields rather than inventing a value", () => {
    const [row] = parseAnitabiPoints("10380", [BASE]);
    expect(row?.origin).toBeNull();
    expect(row?.origin_url).toBeNull();
  });
});
