import { describe, expect, it } from "vitest";
import { inferRailCategory, parseCsv, parseEkidata } from "../src/lib/transit/etl";

const company = "company_cd,company_name,company_type\n1,JR東日本,1\n2,東京メトロ,2\n";
const line = "line_cd,company_cd,line_name,e_status\n10,1,中央線,0\n20,2,地下鉄線,0\n30,1,廃線,1\n";
const station = "station_cd,station_g_cd,station_name,line_cd,lon,lat,e_status\n100,500,接続駅,10,139.7000,35.6900,0\n101,501,隣駅,10,139.7100,35.6900,0\n200,500,接続駅,20,139.7001,35.6901,0\n300,503,廃駅,30,139.72,35.69,1\n";
const join = "line_cd,station_cd1,station_cd2\n10,100,101\n10,101,999\n";

describe("parseCsv", () => {
  it("handles BOM, quoted commas, escaped quotes, and CRLF", () => {
    const rows = parseCsv('\uFEFFid,name\r\n1,"Tokyo, Metro"\r\n2,"A ""quote"""\r\n', ["id", "name"]);
    expect(rows).toEqual([{ id: "1", name: "Tokyo, Metro" }, { id: "2", name: 'A "quote"' }]);
  });

  it("throws only for missing required headers", () => {
    expect(() => parseCsv("id,name\n1,A", ["id", "missing"])).toThrow("Missing required CSV headers: missing");
  });
});

describe("parseEkidata", () => {
  it("builds operational lines, stations, groups, and curved edges", () => {
    const result = parseEkidata({ company, line, station, join });
    expect(result.graph.lines).toEqual([{ line_id: "10", name: "中央線", category: "jr_conventional" }, { line_id: "20", name: "地下鉄線", category: "subway" }]);
    expect(result.graph.stations.map((item) => [item.station_id, item.group_id])).toEqual([["100", "500"], ["101", "501"], ["200", "500"]]);
    expect(result.graph.adjacency).toEqual([{ from: "100", to: "101", distance_m: 1039 }]);
  });

  it("drops a missing-station join with a warning", () => {
    const result = parseEkidata({ company, line, station, join });
    expect(result.warnings).toContain("Dropped join 101→999: station missing or line mismatch");
  });

  it("drops operational stations whose line is unavailable", () => {
    const orphan = `${station}400,504,孤立,999,139.7,35.7,0\n`;
    expect(parseEkidata({ company, line, station: orphan, join }).warnings).toContain("Dropped station 400: missing operational line or valid coordinates");
  });

  it("warns and skips malformed operational company and line rows", () => {
    const companies = `${company}3,,2\n`;
    const lines = `${line}40,999,孤立線,0\n`;
    const warnings = parseEkidata({ company: companies, line: lines, station, join }).warnings;
    expect(warnings).toContain("Dropped company 3: malformed row");
    expect(warnings).toContain("Dropped line 40: malformed row or missing company");
  });
});

describe("inferRailCategory", () => {
  it("covers shinkansen, subway, tram, JR, and private heuristics", () => {
    expect([inferRailCategory("東海道新幹線", "JR", "1"), inferRailCategory("銀座線", "東京メトロ", "2"), inferRailCategory("都電荒川線", "東京都", "0"), inferRailCategory("中央線", "JR東日本", "1"), inferRailCategory("井の頭線", "京王", "2")]).toEqual(["shinkansen", "subway", "tram", "jr_conventional", "private_rail"]);
  });

  it("distinguishes Tokyo subway, Tokyo tram, and Hiroshima rail", () => {
    expect([inferRailCategory("都営大江戸線", "東京都交通局", "2"), inferRailCategory("都電荒川線", "東京都交通局", "2"), inferRailCategory("本線", "広島電鉄", "2"), inferRailCategory("宮島線", "広島電鉄", "2")]).toEqual(["subway", "tram", "tram", "private_rail"]);
  });
});
