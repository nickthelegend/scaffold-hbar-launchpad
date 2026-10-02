"use client";

import { useState } from "react";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import { AssociationNotice } from "~~/components/launchpad/AssociationNotice";
import { ActionButton, AmountField, QuoteRows, type TradeMode, TradeModeTabs } from "~~/components/launchpad/TradeForm";
import { useHtsAllowance } from "~~/hooks/launchpad/useHtsAllowance";
import { useTokenAssociation } from "~~/hooks/launchpad/useTokenAssociation";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-hbar";
import { FEE_BPS } from "~~/utils/launchpad/curve";
import {
  formatHbar,
  formatTokens,
  parseHbar,
  parseTokens,
  tinybarsToWeibars,
  tryParseAmount,
  withSlippage,
} from "~~/utils/launchpad/units";

const SLIPPAGE_BPS = 100; // 1%
const FEE_LABEL = `Fee (${Number(FEE_BPS) / 100}%)`;

/** Buy and sell against the bonding curve. Buys pay HBAR; sells need an HTS allowance for the launchpad. */
export const CurveTradePanel = ({
  token,
  symbol,
  launchpad,
  onTrade,
}: {
  token: Address;
  symbol: string;
  launchpad: Address;
  onTrade: () => void;
}) => {
  const [mode, setMode] = useState<TradeMode>("buy");
  const [input, setInput] = useState("");
  const { address: account } = useAccount();

  const amount = tryParseAmount(mode === "buy" ? parseHbar : parseTokens, input);
  const hasAmount = amount !== undefined && amount > 0n;

  const { data: buyQuote } = useScaffoldReadContract({
    contractName: "Launchpad",
    functionName: "quoteBuy",
    args: [token, mode === "buy" && hasAmount ? amount : undefined],
  });
  const { data: sellQuote } = useScaffoldReadContract({
    contractName: "Launchpad",
    functionName: "quoteSell",
    args: [token, mode === "sell" && hasAmount ? amount : undefined],
  });

  const tokens = useHtsAllowance(token, launchpad);
  const association = useTokenAssociation(token);
  const { writeContractAsync, isMining } = useScaffoldWriteContract({ contractName: "Launchpad" });

  const insufficientTokens = mode === "sell" && hasAmount && (tokens.balance ?? 0n) < amount;
  const needsApproval = mode === "sell" && hasAmount && tokens.allowance < amount;

  const afterTrade = () => {
    setInput("");
    tokens.refetch();
    onTrade();
  };

  const buy = async () => {
    if (!buyQuote || !hasAmount) return;
    await writeContractAsync(
      {
        functionName: "buy",
        args: [token, withSlippage(buyQuote[0], SLIPPAGE_BPS)],
        // `value` goes over JSON-RPC, so it is in weibars; the contract sees tinybars.
        value: tinybarsToWeibars(amount),
      },
      { onBlockConfirmation: afterTrade },
    );
  };

  const sell = async () => {
    if (!sellQuote || !hasAmount) return;
    await writeContractAsync(
      { functionName: "sell", args: [token, amount, withSlippage(sellQuote[0], SLIPPAGE_BPS)] },
      { onBlockConfirmation: afterTrade },
    );
  };

  return (
    <div className="bg-base-100 rounded-2xl border border-base-300 p-5 flex flex-col gap-4">
      <TradeModeTabs
        mode={mode}
        onChange={next => {
          setMode(next);
          setInput("");
        }}
      />
      <AmountField mode={mode} symbol={symbol} value={input} onChange={setInput} tokenBalance={tokens.balance} />

      {mode === "buy" && buyQuote && hasAmount && (
        <QuoteRows
          rows={[
            ["You receive", `${formatTokens(buyQuote[0])} ${symbol}`],
            [FEE_LABEL, `${formatHbar(buyQuote[1])} HBAR`],
            ...(buyQuote[2] > 0n
              ? ([["Refunded", `${formatHbar(buyQuote[2])} HBAR — this buy graduates the token`]] as const)
              : []),
          ]}
        />
      )}
      {mode === "sell" && sellQuote && hasAmount && (
        <QuoteRows
          rows={[
            ["You receive", `${formatHbar(sellQuote[0])} HBAR`],
            [FEE_LABEL, `${formatHbar(sellQuote[1])} HBAR`],
          ]}
        />
      )}

      {mode === "buy" && association.canReceive === false ? (
        <AssociationNotice
          symbol={symbol}
          onAssociate={association.associate}
          isAssociating={association.isAssociating}
        />
      ) : mode === "buy" ? (
        <ActionButton
          label={account ? "Buy" : "Connect a wallet"}
          pending={isMining}
          disabled={!account || !hasAmount || !buyQuote}
          onClick={buy}
        />
      ) : needsApproval && !insufficientTokens ? (
        <ActionButton
          label={`Approve ${symbol}`}
          variant="btn-secondary"
          pending={tokens.isApproving}
          disabled={false}
          onClick={() => amount && tokens.approve(amount)}
        />
      ) : (
        <ActionButton
          label={insufficientTokens ? "Insufficient balance" : account ? "Sell" : "Connect a wallet"}
          pending={isMining}
          disabled={!account || !hasAmount || !sellQuote || insufficientTokens}
          onClick={sell}
        />
      )}
      <p className="text-xs text-base-content/50 m-0">Slippage tolerance 1%. Prices are set by the bonding curve.</p>
    </div>
  );
};
