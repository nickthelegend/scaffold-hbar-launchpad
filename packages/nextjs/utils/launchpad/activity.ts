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

  // Uniswap V2 orders pair tokens by address; the lower address is token0.
  const tokenIsToken0 = BigInt(token) < BigInt(whbar);
  const poolPoints = syncs.map(sync => {
    const [reserveToken, reserveHbar] = tokenIsToken0 ? [sync.reserve0, sync.reserve1] : [sync.reserve1, sync.reserve0];
    return { time: sync.timestamp, price: priceToHbar(poolPrice(reserveHbar, reserveToken)) };
  });

  return [...curvePoints, ...poolPoints].filter(point => point.price > 0);
}

/** Sums buy and sell volume (tinybars) from curve trades. */
export function curveVolume(trades: TradeEvent[]): bigint {
  return trades.reduce((total, trade) => total + trade.hbarAmount, 0n);
}
