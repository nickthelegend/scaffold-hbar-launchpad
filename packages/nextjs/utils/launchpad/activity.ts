import type { PricePoint } from "./candles";
import { poolPrice, priceToHbar, spotPrice } from "./curve";
import type { PoolSync, TradeEvent } from "./mirror";
import type { Address } from "viem";

/**
 * Builds one price series spanning both lifecycle phases: curve trades (priced from the reserves each
 * `Trade` event reports) followed by SaucerSwap pool updates (priced from `Sync` reserves).
 * Prices are HBAR per whole token.
 */
export function toPricePoints(
  threshold: bigint,
  trades: TradeEvent[],
  syncs: PoolSync[],
  token: Address,
  whbar: Address,
): PricePoint[] {
  const curvePoints = trades.map(trade => ({
    time: trade.timestamp,
    price: priceToHbar(spotPrice(threshold, trade)),
  }));

  const poolPoints = syncs.map(sync => ({
    time: sync.timestamp,
    price: priceToHbar(poolPriceAt(sync, token, whbar)),
  }));

  return [...curvePoints, ...poolPoints].filter(point => point.price > 0);
}

/** Scaled pool price (see `PRICE_SCALE`) after a `Sync`. Uniswap V2 orders pair tokens by address: lower is token0. */
export function poolPriceAt(sync: PoolSync, token: Address, whbar: Address): bigint {
  const tokenIsToken0 = BigInt(token) < BigInt(whbar);
  const [reserveToken, reserveHbar] = tokenIsToken0 ? [sync.reserve0, sync.reserve1] : [sync.reserve1, sync.reserve0];
  return poolPrice(reserveHbar, reserveToken);
}

/** Sums buy and sell volume (tinybars) from curve trades. */
export function curveVolume(trades: TradeEvent[]): bigint {
  return trades.reduce((total, trade) => total + trade.hbarAmount, 0n);
}
