import {
  CURVE_SUPPLY,
  LIQUIDITY_SUPPLY,
  PRICE_SCALE,
  marketCap,
  poolPrice,
  priceToHbar,
  progressBps,
  spotPrice,
} from "../curve";
import { describe, expect, it } from "vitest";

const THRESHOLD = 25n * 10n ** 8n; // 25 HBAR

describe("curve", () => {
  it("starts at a quarter of the graduation price", () => {
    const start = spotPrice(THRESHOLD, { hbarRaised: 0n, tokensLeft: CURVE_SUPPLY });
    const end = spotPrice(THRESHOLD, { hbarRaised: THRESHOLD, tokensLeft: 0n });
    // (T/3) / (4C/3) vs (4T/3) / (C/3): the curve price rises 16x end to end.
    expect(Number(end) / Number(start)).toBeCloseTo(16, 3);
  });

  it("ends at the SaucerSwap opening price", () => {
    const curveEnd = spotPrice(THRESHOLD, { hbarRaised: THRESHOLD, tokensLeft: 0n });
    // Equal up to the ~1e-10 offset from flooring `threshold / 3` (same as the contract).
    expect(priceToHbar(curveEnd)).toBeCloseTo(priceToHbar(poolPrice(THRESHOLD, LIQUIDITY_SUPPLY)), 15);
  });

  it("keeps sub-tinybar prices non-zero", () => {
    const start = spotPrice(THRESHOLD, { hbarRaised: 0n, tokensLeft: CURVE_SUPPLY });
    expect(start).toBeGreaterThan(0n);
    expect(priceToHbar(start)).toBeCloseTo(25 / 3 / ((800_000_000 * 4) / 3), 15);
  });

  it("computes market cap over the full supply", () => {
    // 1 tinybar per whole token × 1e9 tokens = 1e9 tinybars (10 HBAR).
    expect(marketCap(PRICE_SCALE)).toBe(1_000_000_000n);
  });

  it("clamps progress to 100%", () => {
    expect(progressBps(THRESHOLD, THRESHOLD / 2n)).toBe(5_000);
    expect(progressBps(THRESHOLD, THRESHOLD * 2n)).toBe(10_000);
    expect(progressBps(0n, 1n)).toBe(0);
  });
});
