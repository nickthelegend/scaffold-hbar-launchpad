import { formatUnits } from "viem";
import { TOKEN_DECIMALS, formatTokens } from "~~/utils/launchpad/units";

export type TradeMode = "buy" | "sell";

/** Buy / sell switch shared by the curve and SaucerSwap panels. */
export const TradeModeTabs = ({ mode, onChange }: { mode: TradeMode; onChange: (mode: TradeMode) => void }) => (
  <div role="tablist" className="tabs tabs-box">
    {(["buy", "sell"] as const).map(tab => (
      <button
        key={tab}
        role="tab"
        className={`tab flex-1 capitalize ${mode === tab ? "tab-active" : ""}`}
        onClick={() => onChange(tab)}
      >
        {tab}
      </button>
    ))}
  </div>
);

type AmountFieldProps = {
  mode: TradeMode;
  symbol: string;
  value: string;
  onChange: (value: string) => void;
  /** Token balance; shown (and usable as "max") when selling. */
  tokenBalance?: bigint;
};

/** Amount input: HBAR when buying, tokens when selling. */
export const AmountField = ({ mode, symbol, value, onChange, tokenBalance }: AmountFieldProps) => (
  <label className="flex flex-col gap-1">
    <span className="text-xs text-base-content/60 flex justify-between">
      <span>{mode === "buy" ? "You pay (HBAR)" : `You sell (${symbol})`}</span>
      {mode === "sell" && tokenBalance !== undefined && (
        <button
          type="button"
          className="link link-hover"
          onClick={() => onChange(formatUnits(tokenBalance, TOKEN_DECIMALS))}
        >
          Balance: {formatTokens(tokenBalance)}
        </button>
      )}
    </span>
    <input
      className="input input-bordered w-full text-lg"
      inputMode="decimal"
      placeholder="0.0"
      value={value}
      onChange={e => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
    />
  </label>
);

/** Label / value rows under the amount field (quote, fees, refunds). */
export const QuoteRows = ({ rows }: { rows: readonly (readonly [string, string])[] }) => (
  <dl className="text-sm flex flex-col gap-1 m-0">
    {rows.map(([label, value]) => (
      <div key={label} className="flex justify-between gap-4">
        <dt className="text-base-content/60">{label}</dt>
        <dd className="m-0 text-right font-medium">{value}</dd>
      </div>
    ))}
  </dl>
);

/** Primary action with a spinner while pending. */
export const ActionButton = ({
  label,
  pending,
  disabled,
  onClick,
  variant = "btn-primary",
}: {
  label: string;
  pending: boolean;
  disabled: boolean;
  onClick: () => void;
  variant?: string;
}) => (
  <button className={`btn ${variant}`} disabled={disabled || pending} onClick={onClick}>
    {pending ? <span className="loading loading-spinner loading-sm" /> : label}
  </button>
);
