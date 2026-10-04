export const HBAR_PRICE_CACHE_DURATION_MS = 60 * 1000;
/**
 * Hedera's own HBAR/USD exchange rate (the one behind the 0x168 system contract), served by the mainnet mirror node.
 * Unlike public price APIs it needs no key, is not rate limited and allows browser requests (CORS `*`).
 */
export const HBAR_PRICE_URL = "https://mainnet-public.mirrornode.hedera.com/api/v1/network/exchangerate";

type HbarPriceCache = {
  price: number;
  timestamp: number;
};

type ExchangeRateResponse = {
  current_rate?: { cent_equivalent: number; hbar_equivalent: number };
};

let cache: HbarPriceCache | null = null;

/** USD per HBAR from an exchange-rate response, or undefined if it is malformed. */
export function priceFromExchangeRate(data: ExchangeRateResponse): number | undefined {
  const rate = data.current_rate;
  if (!rate || !rate.hbar_equivalent) return undefined;
  return rate.cent_equivalent / rate.hbar_equivalent / 100;
}

export async function fetchHbarPrice(): Promise<number> {
  const now = Date.now();
  if (cache && now - cache.timestamp < HBAR_PRICE_CACHE_DURATION_MS) {
    return cache.price;
  }

  try {
    const response = await fetch(HBAR_PRICE_URL);
    if (!response.ok) return cache?.price ?? 0;
    const price = priceFromExchangeRate(await response.json());
    if (price === undefined) return cache?.price ?? 0;
    cache = { price, timestamp: now };
    return price;
  } catch {
    // The price is decorative (footer badge); keep the last known value instead of logging on every retry.
    return cache?.price ?? 0;
  }
}
