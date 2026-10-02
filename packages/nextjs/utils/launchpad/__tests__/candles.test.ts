import { pickInterval, toCandles } from "../candles";
import { describe, expect, it } from "vitest";

describe("toCandles", () => {
  it("buckets unordered points into OHLC bars", () => {
    const candles = toCandles(
      [
        { time: 130, price: 3 },
        { time: 100, price: 1 },
        { time: 110, price: 5 },
        { time: 170, price: 2 },
      ],
      60,
    );
    expect(candles).toEqual([
      { time: 60, open: 1, high: 5, low: 1, close: 5 },
      { time: 120, open: 5, high: 5, low: 2, close: 2 },
    ]);
  });

  it("opens each candle at the previous close", () => {
    const [first, second] = toCandles(
      [
        { time: 0, price: 10 },
        { time: 120, price: 12 },
      ],
      60,
    );
    expect(first.close).toBe(10);
    expect(second.open).toBe(10);
    expect(second.low).toBe(10);
  });

  it("rejects non-positive intervals", () => {
    expect(() => toCandles([], 0)).toThrow();
  });
});

describe("pickInterval", () => {
  it("chooses wider candles for longer histories", () => {
    expect(pickInterval([{ time: 0, price: 1 }])).toBe(60);
    expect(
      pickInterval([
        { time: 0, price: 1 },
        { time: 1_800, price: 1 },
      ]),
    ).toBe(60);
    expect(
      pickInterval([
        { time: 0, price: 1 },
        { time: 86_400, price: 1 },
      ]),
    ).toBe(3_600);
  });
});
