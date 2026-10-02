import { formatUnits, parseUnits } from "viem";

/**
 * HBAR has two decimal conventions on Hedera:
 * - Inside the EVM (contract args, return values, events) amounts are in tinybars: 8 decimals.
 * - Over JSON-RPC (`value` on a transaction, `eth_getBalance`) amounts are in weibars: 18 decimals.
 * The relay converts between them, so a `value` must be sent in weibars but everything the
 * Launchpad contract returns is in tinybars.
 */
export const TINYBAR_DECIMALS = 8;
export const WEIBARS_PER_TINYBAR = 10n ** 10n;

/** Launchpad tokens use 8 decimals, like HBAR. */
export const TOKEN_DECIMALS = 8;
export const WHOLE_TOKEN = 10n ** BigInt(TOKEN_DECIMALS);

export const tinybarsToWeibars = (tinybars: bigint): bigint => tinybars * WEIBARS_PER_TINYBAR;

export const parseHbar = (hbar: string): bigint => parseUnits(hbar || "0", TINYBAR_DECIMALS);
export const parseTokens = (amount: string): bigint => parseUnits(amount || "0", TOKEN_DECIMALS);

/** Formats tinybars as HBAR with at most `maxFractionDigits` decimals, trimming trailing zeros. */
export function formatHbar(tinybars: bigint, maxFractionDigits = 4): string {
  return trimDecimals(formatUnits(tinybars, TINYBAR_DECIMALS), maxFractionDigits);
}

/** Formats token base units with compact suffixes for large values (e.g. 812.4M). */
export function formatTokens(baseUnits: bigint, maxFractionDigits = 2): string {
  const whole = Number(formatUnits(baseUnits, TOKEN_DECIMALS));
  if (whole >= 1_000_000) {
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(whole);
  }
  return trimDecimals(formatUnits(baseUnits, TOKEN_DECIMALS), maxFractionDigits);
}

function trimDecimals(value: string, maxFractionDigits: number): string {
  const [integer, fraction = ""] = value.split(".");
  const trimmed = fraction.slice(0, maxFractionDigits).replace(/0+$/, "");
  return trimmed ? `${integer}.${trimmed}` : integer;
}

/** Applies a slippage tolerance (in basis points) to an expected output, rounding down. */
export function withSlippage(expected: bigint, slippageBps: number): bigint {
  return (expected * BigInt(10_000 - slippageBps)) / 10_000n;
}

/** Parses user input with `parse`, returning `undefined` for anything that is not a valid amount. */
export function tryParseAmount(parse: (value: string) => bigint, value: string): bigint | undefined {
  try {
    return parse(value);
  } catch {
    return undefined;
  }
}
