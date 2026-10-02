"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  createChart,
} from "lightweight-charts";
import { useTheme } from "next-themes";
import { type PricePoint, pickInterval, toCandles } from "~~/utils/launchpad/candles";
import { TOTAL_SUPPLY } from "~~/utils/launchpad/curve";
import { WHOLE_TOKEN } from "~~/utils/launchpad/units";

/** Per-token prices are tiny (~1e-8 HBAR); multiplying by the supply gives a readable market-cap series. */
const SUPPLY_WHOLE_TOKENS = Number(TOTAL_SUPPLY / WHOLE_TOKEN);

/**
 * Candlestick chart of market cap (HBAR) built from mirror-node history: bonding-curve trades
 * followed by SaucerSwap pool updates after graduation.
 */
export const MarketCapChart = ({ points }: { points: PricePoint[] }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const candles = useMemo(() => {
    const marketCaps = points.map(p => ({ time: p.time, price: p.price * SUPPLY_WHOLE_TOKENS }));
    return toCandles(marketCaps, pickInterval(marketCaps)).map(c => ({ ...c, time: c.time as UTCTimestamp }));
  }, [points]);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: isDark ? "#c9c9d1" : "#3b3b46",
      },
      grid: {
        vertLines: { color: isDark ? "#2a2a33" : "#ececf1" },
        horzLines: { color: isDark ? "#2a2a33" : "#ececf1" },
      },
      timeScale: { timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderVisible: false },
    });
    seriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      borderVisible: false,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [isDark]);

  useEffect(() => {
    seriesRef.current?.setData(candles);
    chartRef.current?.timeScale().fitContent();
  }, [candles, isDark]);

  return (
    <div className="bg-base-100 rounded-2xl border border-base-300 p-4">
      <div className="flex justify-between items-baseline mb-2">
        <h3 className="font-bold m-0">Market cap (HBAR)</h3>
        <span className="text-xs text-base-content/50">from Hedera mirror node</span>
      </div>
      <div className="relative h-72">
        <div ref={containerRef} className="absolute inset-0" />
        {candles.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-base-content/50">
            No trades yet — be the first.
          </div>
        )}
      </div>
    </div>
  );
};
