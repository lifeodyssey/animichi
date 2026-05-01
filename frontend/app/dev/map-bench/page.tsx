"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import dynamic from "next/dynamic";

const BaseMap = dynamic(() => import("../../../components/map/BaseMap"), { ssr: false });

// Mock points — Euphonium spots in Uji
const BENCH_POINTS = [
  { id: "1", name: "京都コンサートホール", name_cn: "京都音乐厅", episode: 1, time_seconds: 85, screenshot_url: null, bangumi_id: "115908", latitude: 34.8892, longitude: 135.7983, title: "響け！ユーフォニアム", title_cn: "吹响！上低音号" },
  { id: "2", name: "あじろぎの道", name_cn: "网代木之路", episode: 1, time_seconds: 340, screenshot_url: null, bangumi_id: "115908", latitude: 34.8873, longitude: 135.8072, title: "響け！ユーフォニアム", title_cn: "吹响！上低音号" },
  { id: "3", name: "莵道高", name_cn: "莵道高中", episode: 1, time_seconds: 520, screenshot_url: null, bangumi_id: "115908", latitude: 34.8901, longitude: 135.8055, title: "響け！ユーフォニアム", title_cn: "吹响！上低音号" },
  { id: "4", name: "宇治橋", name_cn: "宇治桥", episode: 2, time_seconds: 180, screenshot_url: null, bangumi_id: "115908", latitude: 34.8847, longitude: 135.8008, title: "響け！ユーフォニアム", title_cn: "吹响！上低音号" },
  { id: "5", name: "中書島駅", name_cn: "中书岛站", episode: 3, time_seconds: 90, screenshot_url: null, bangumi_id: "115908", latitude: 34.9032, longitude: 135.7642, title: "響け！ユーフォニアム", title_cn: "吹响！上低音号" },
  { id: "6", name: "平等院表参道", name_cn: "平等院表参道", episode: 3, time_seconds: 420, screenshot_url: null, bangumi_id: "115908", latitude: 34.8856, longitude: 135.8044, title: "響け！ユーフォニアム", title_cn: "吹响！上低音号" },
  { id: "7", name: "宇治駅前商店街", name_cn: "宇治站前商店街", episode: 4, time_seconds: 600, screenshot_url: null, bangumi_id: "115908", latitude: 34.8841, longitude: 135.8007, title: "響け！ユーフォニアム", title_cn: "吹响！上低音号" },
  { id: "8", name: "朝霧橋", name_cn: "朝雾桥", episode: 5, time_seconds: 300, screenshot_url: null, bangumi_id: "115908", latitude: 34.8868, longitude: 135.8092, title: "響け！ユーフォニアム", title_cn: "吹响！上低音号" },
  { id: "9", name: "興聖寺", name_cn: "兴圣寺", episode: 6, time_seconds: 480, screenshot_url: null, bangumi_id: "115908", latitude: 34.8882, longitude: 135.8101, title: "響け！ユーフォニアム", title_cn: "吹响！上低音号" },
  { id: "10", name: "京阪宇治駅", name_cn: "京阪宇治站", episode: 7, time_seconds: 200, screenshot_url: null, bangumi_id: "115908", latitude: 34.8835, longitude: 135.8063, title: "響け！ユーフォニアム", title_cn: "吹响！上低音号" },
  { id: "11", name: "県神社", name_cn: "县神社", episode: 8, time_seconds: 720, screenshot_url: null, bangumi_id: "115908", latitude: 34.8859, longitude: 135.8038, title: "響け！ユーフォニアム", title_cn: "吹响！上低音号" },
  { id: "12", name: "大吉山展望台", name_cn: "大吉山展望台", episode: 8, time_seconds: 900, screenshot_url: null, bangumi_id: "115908", latitude: 34.8915, longitude: 135.8110, title: "響け！ユーフォニアム", title_cn: "吹响！上低音号" },
];

const STYLES = [
  { id: "streets", label: "Streets v12", url: "mapbox://styles/mapbox/streets-v12", note: "默认, 详细街道" },
  { id: "light", label: "Light", url: "mapbox://styles/mapbox/light-v11", note: "浅色极简, 适合叠加数据" },
  { id: "outdoors", label: "Outdoors", url: "mapbox://styles/mapbox/outdoors-v12", note: "等高线+步道, 适合巡礼" },
];

interface BenchResult {
  styleId: string;
  loadMs: number;
}

export default function MapBenchPage() {
  const [results, setResults] = useState<BenchResult[]>([]);
  const [running, setRunning] = useState(false);
  const startTimeRef = useRef(0);

  const handleLoaded = useCallback((styleId: string) => {
    const elapsed = performance.now() - startTimeRef.current;
    setResults((prev) => {
      if (prev.find((r) => r.styleId === styleId)) return prev;
      return [...prev, { styleId, loadMs: Math.round(elapsed) }];
    });
  }, []);

  const handleStart = useCallback(() => {
    setResults([]);
    setRunning(false);
    requestAnimationFrame(() => {
      startTimeRef.current = performance.now();
      setRunning(true);
    });
  }, []);

  return (
    <div className="mx-auto max-w-[1200px] p-6 font-sans">
      <h1 className="mb-2 font-display text-2xl">
        Mapbox GL JS 性能测试
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Mapbox GL (vector tiles, GPU 渲染)。对比 3 种地图样式的加载速度。12 个标记点。
      </p>

      <button
        onClick={handleStart}
        className="mb-6 cursor-pointer rounded-lg border-none bg-primary px-6 py-2 text-sm font-semibold text-primary-fg"
      >
        {running ? "重新测试" : "开始测试"}
      </button>

      {/* Results table */}
      {results.length > 0 && (
        <table className="mb-6 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-border">
              <th className="px-3 py-2 text-left">Style</th>
              <th className="px-3 py-2 text-right">加载时间 (ms)</th>
              <th className="px-3 py-2 text-left">评价</th>
            </tr>
          </thead>
          <tbody>
            {results
              .sort((a, b) => a.loadMs - b.loadMs)
              .map((r, i) => (
                <tr key={r.styleId} className="border-b border-border">
                  <td className={cn("px-3 py-2", i === 0 && "font-semibold")}>
                    {i === 0 ? "🏆 " : ""}{STYLES.find((s) => s.id === r.styleId)?.label}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.loadMs}ms
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.loadMs < 800 ? "快" : r.loadMs < 2000 ? "一般" : "慢"}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      )}

      {/* Maps side by side */}
      {running && (
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${STYLES.length}, 1fr)` }}>
          {STYLES.map((style) => (
            <div key={style.id} className="overflow-hidden rounded-lg border border-border">
              <div className="border-b border-border px-3 py-2 text-sm font-semibold">
                {style.label}
                <span className="ml-2 font-normal text-muted-foreground">
                  {results.find((r) => r.styleId === style.id)
                    ? `${results.find((r) => r.styleId === style.id)?.loadMs}ms`
                    : "加载中…"}
                </span>
              </div>
              <BaseMap
                points={BENCH_POINTS}
                mapStyle={style.url}
                height={360}
                onAllTilesLoaded={() => handleLoaded(style.id)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
