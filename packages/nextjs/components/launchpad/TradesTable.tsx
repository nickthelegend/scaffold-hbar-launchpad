import { AccountLabel } from "./AccountLabel";
import { HashscanLink } from "./HashscanLink";
import type { TradeEvent } from "~~/utils/launchpad/mirror";
import { formatHbar, formatTokens } from "~~/utils/launchpad/units";

export const TradesTable = ({ trades, symbol }: { trades: TradeEvent[]; symbol: string }) => (
  <div className="bg-base-100 rounded-2xl border border-base-300 p-4">
    <h3 className="font-bold m-0 mb-3">Curve trades</h3>
    {trades.length === 0 ? (
      <p className="text-sm text-base-content/50 m-0">No trades yet.</p>
    ) : (
      <div className="overflow-x-auto">
        <table className="table table-sm">
          <thead>
            <tr>
              <th>Trader</th>
              <th>Side</th>
              <th className="text-right">HBAR</th>
              <th className="text-right">{symbol}</th>
              <th className="text-right">Tx</th>
            </tr>
          </thead>
          <tbody>
            {[...trades].reverse().map(trade => (
              <tr key={trade.transactionHash + trade.isBuy}>
                <td>
                  <AccountLabel address={trade.trader} />
                </td>
                <td className={trade.isBuy ? "text-success" : "text-error"}>{trade.isBuy ? "Buy" : "Sell"}</td>
                <td className="text-right">{formatHbar(trade.hbarAmount, 2)}</td>
                <td className="text-right">{formatTokens(trade.tokenAmount)}</td>
                <td className="text-right">
                  <HashscanLink path={`transaction/${trade.transactionHash}`} label={timeAgo(trade.timestamp)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

function timeAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}
