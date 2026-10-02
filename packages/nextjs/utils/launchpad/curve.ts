import { WHOLE_TOKEN } from "./units";

/**
 * Mirrors `contracts/libraries/BondingCurve.sol` so the UI can price trades and chart history without
 * an RPC round-trip per point. Must stay in sync with the contract constants.
 */
export const TOTAL_SUPPLY = 1_000_000_000n * WHOLE_TOKEN;
export const CURVE_SUPPLY = (TOTAL_SUPPLY * 4n) / 5n;
export const LIQUIDITY_SUPPLY = TOTAL_SUPPLY - CURVE_SUPPLY;
export const FEE_BPS = 100n;
/**
 * Prices are tinybars per whole token scaled by 1e18 (matching `Launchpad.PRICE_SCALE`): early curve prices are
 * below one tinybar per token, so unscaled integers would round them to zero.
 */
export const PRICE_SCALE = 10n ** 18n;

export type CurveState = {
  /** Real tinybars raised on the curve. */
  hbarRaised: bigint;
  /** Tokens still for sale on the curve, in base units. */
  tokensLeft: bigint;
};

/** Curve spot price (scaled, see `PRICE_SCALE`). */
export function spotPrice(threshold: bigint, state: CurveState): bigint {
  const virtualHbar = threshold / 3n + state.hbarRaised;
  const virtualTokens = CURVE_SUPPLY / 3n + state.tokensLeft;
  return (virtualHbar * WHOLE_TOKEN * PRICE_SCALE) / virtualTokens;
}

/** Fully diluted market cap in tinybars for a scaled price. */
export function marketCap(price: bigint): bigint {
  return (price * TOTAL_SUPPLY) / WHOLE_TOKEN / PRICE_SCALE;
}

const SCALED_TINYBARS_PER_HBAR = 1e8 * Number(PRICE_SCALE);

/** Converts a scaled price to HBAR per whole token as a float, for display and charts. */
export function priceToHbar(price: bigint): number {
  return Number(price) / SCALED_TINYBARS_PER_HBAR;
}

/** Inverse of `priceToHbar` (float precision). */
export function hbarToPrice(hbar: number): bigint {
  return BigInt(Math.round(hbar * SCALED_TINYBARS_PER_HBAR));
}

/** Progress towards graduation in basis points (0–10000). */
export function progressBps(threshold: bigint, hbarRaised: bigint): number {
  if (threshold === 0n) return 0;
  const bps = (hbarRaised * 10_000n) / threshold;
  return Number(bps > 10_000n ? 10_000n : bps);
}

/** Price of a SaucerSwap pool (scaled, see `PRICE_SCALE`) from its reserves. */
export function poolPrice(reserveHbar: bigint, reserveToken: bigint): bigint {
  if (reserveToken === 0n) return 0n;
  return (reserveHbar * WHOLE_TOKEN * PRICE_SCALE) / reserveToken;
}
