import { curveVolume, toPricePoints } from "../activity";
import { CURVE_SUPPLY, LIQUIDITY_SUPPLY } from "../curve";
import type { TradeEvent } from "../mirror";
import type { Address, Hex } from "viem";
import { describe, expect, it } from "vitest";

const THRESHOLD = 25n * 10n ** 8n;
const WHBAR = "0x0000000000000000000000000000000000003aD2" as Address;
const TOKEN_ABOVE_WHBAR = "0x0000000000000000000000000000000000a53fc6" as Address;

const trade = (overrides: Partial<TradeEvent>): TradeEvent => ({
  trader: "0x0000000000000000000000000000000000000001",
  isBuy: true,
  hbarAmount: 10n ** 8n,
  tokenAmount: 0n,
  fee: 0n,
  hbarRaised: 0n,
  tokensLeft: CURVE_SUPPLY,
  timestamp: 1,
  transactionHash: "0x01" as Hex,
  ...overrides,
});

describe("toPricePoints", () => {
  it("joins curve trades and pool syncs into one continuous series", () => {
    const points = toPricePoints(
      THRESHOLD,
      [trade({ timestamp: 10, hbarRaised: THRESHOLD, tokensLeft: 0n })],
      // WHBAR has the lower address, so it is token0 and reserve0 is HBAR.
      [{ reserve0: THRESHOLD, reserve1: LIQUIDITY_SUPPLY, timestamp: 11 }],
      TOKEN_ABOVE_WHBAR,
      WHBAR,
    );
    expect(points).toHaveLength(2);
    expect(points[0].price).toBeCloseTo(points[1].price, 10);
  });

  it("orients reserves by token address", () => {
    const token0 = "0x0000000000000000000000000000000000000100" as Address;
    const [point] = toPricePoints(
      THRESHOLD,
      [],
      [{ reserve0: LIQUIDITY_SUPPLY, reserve1: THRESHOLD, timestamp: 1 }],
      token0,
      WHBAR,
    );
    expect(point.price).toBeCloseTo(25 / 200_000_000, 15);
  });
});

describe("curveVolume", () => {
  it("sums HBAR across buys and sells", () => {
    expect(curveVolume([trade({ hbarAmount: 5n }), trade({ hbarAmount: 7n, isBuy: false })])).toBe(12n);
  });
});
