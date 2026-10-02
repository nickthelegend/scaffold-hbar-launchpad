export type PricePoint = {
  /** Unix seconds. */
  time: number;
  /** Price as a plain number (HBAR per whole token) — charts do not take bigints. */
  price: number;
};

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

/**
 * Buckets price points into OHLC candles of `intervalSeconds`. Points may arrive in any order.
 * Each candle opens at the previous candle's close so the series has no gaps between bars.
 */
export function toCandles(points: PricePoint[], intervalSeconds: number): Candle[] {
  if (intervalSeconds <= 0) throw new Error("intervalSeconds must be positive");
  const sorted = [...points].sort((a, b) => a.time - b.time);
  const candles: Candle[] = [];

  for (const { time, price } of sorted) {
    const bucket = Math.floor(time / intervalSeconds) * intervalSeconds;
    const last = candles[candles.length - 1];
    if (last && last.time === bucket) {
      last.high = Math.max(last.high, price);
      last.low = Math.min(last.low, price);
      last.close = price;
      continue;
    }
    const open = last ? last.close : price;
    candles.push({ time: bucket, open, high: Math.max(open, price), low: Math.min(open, price), close: price });
  }
  return candles;
}

/** Picks a candle width that yields roughly `targetCandles` bars over the data's time span. */
export function pickInterval(points: PricePoint[], targetCandles = 40): number {
  const steps = [60, 300, 900, 3_600, 14_400, 86_400];
  if (points.length < 2) return steps[0];
  const times = points.map(p => p.time);
  const span = Math.max(...times) - Math.min(...times);
  return steps.find(step => span / step <= targetCandles) ?? steps[steps.length - 1];
}
