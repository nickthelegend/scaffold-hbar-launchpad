"use client";

import { useState } from "react";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import { AssociationNotice } from "~~/components/launchpad/AssociationNotice";
import { ActionButton, AmountField, QuoteRows, type TradeMode, TradeModeTabs } from "~~/components/launchpad/TradeForm";
import { useHtsAllowance } from "~~/hooks/launchpad/useHtsAllowance";
import { useTokenAssociation } from "~~/hooks/launchpad/useTokenAssociation";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-hbar";
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
const DEADLINE_SECONDS = 300;

/**
 * Trades a graduated token directly against its SaucerSwap V1 pool. Quotes come from the router's
 * `getAmountsOut`; HBAR is wrapped/unwrapped by the router (`swapExactETHForTokens` / `swapExactTokensForETH`).
 */
export const SaucerSwapTradePanel = ({
  token,
  symbol,
  whbar,
  onTrade,
}: {
  token: Address;
  symbol: string;
  whbar: Address;
  onTrade: () => void;
}) => {
  const [mode, setMode] = useState<TradeMode>("buy");
  const [input, setInput] = useState("");
  const { address: account } = useAccount();
  const { data: router } = useDeployedContractInfo({ contractName: "SaucerSwapRouter" });

  const amount = tryParseAmount(mode === "buy" ? parseHbar : parseTokens, input);
  const hasAmount = amount !== undefined && amount > 0n;
  const path = mode === "buy" ? [whbar, token] : [token, whbar];

  const { data: amounts } = useScaffoldReadContract({
    contractName: "SaucerSwapRouter",
    functionName: "getAmountsOut",
    args: [hasAmount ? amount : undefined, path],
  });
  const amountOut = amounts?.[1];

  const tokens = useHtsAllowance(token, router?.address);
  const association = useTokenAssociation(token);
  const { writeContractAsync, isMining } = useScaffoldWriteContract({ contractName: "SaucerSwapRouter" });

  const insufficientTokens = mode === "sell" && hasAmount && (tokens.balance ?? 0n) < amount;
  const needsApproval = mode === "sell" && hasAmount && tokens.allowance < amount;
  const deadline = () => BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);

  const afterTrade = () => {
    setInput("");
    tokens.refetch();
    onTrade();
  };

  const swap = async () => {
    if (!account || !hasAmount || amountOut === undefined) return;
    const minOut = withSlippage(amountOut, SLIPPAGE_BPS);
    if (mode === "buy") {
      await writeContractAsync(
        {
          functionName: "swapExactETHForTokens",
          args: [minOut, path, account, deadline()],
          value: tinybarsToWeibars(amount),
        },
        { onBlockConfirmation: afterTrade },
      );
    } else {
      await writeContractAsync(
        { functionName: "swapExactTokensForETH", args: [amount, minOut, path, account, deadline()] },
        { onBlockConfirmation: afterTrade },
      );
    }
  };

  return (
    <div className="bg-base-100 rounded-2xl border border-success/40 p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold m-0">Trade on SaucerSwap</h3>
        <span className="badge badge-success badge-sm whitespace-nowrap">Liquidity locked</span>
      </div>
      <TradeModeTabs
        mode={mode}
        onChange={next => {
          setMode(next);
          setInput("");
        }}
      />
      <AmountField mode={mode} symbol={symbol} value={input} onChange={setInput} tokenBalance={tokens.balance} />

      {hasAmount && amountOut !== undefined && (
        <QuoteRows
          rows={[
            ["You receive", mode === "buy" ? `${formatTokens(amountOut)} ${symbol}` : `${formatHbar(amountOut)} HBAR`],
            ["Pool fee", "0.3% (SaucerSwap V1)"],
          ]}
        />
      )}

      {mode === "buy" && association.canReceive === false ? (
        <AssociationNotice
          symbol={symbol}
          onAssociate={association.associate}
          isAssociating={association.isAssociating}
        />
      ) : needsApproval && !insufficientTokens ? (
        <ActionButton
          label={`Approve ${symbol} for SaucerSwap`}
          variant="btn-secondary"
          pending={tokens.isApproving}
          disabled={false}
          onClick={() => amount && tokens.approve(amount)}
        />
      ) : (
        <ActionButton
          label={insufficientTokens ? "Insufficient balance" : account ? "Swap" : "Connect a wallet"}
          variant="btn-success"
          pending={isMining}
          disabled={!account || !hasAmount || amountOut === undefined || insufficientTokens}
          onClick={swap}
        />
      )}
    </div>
  );
};
