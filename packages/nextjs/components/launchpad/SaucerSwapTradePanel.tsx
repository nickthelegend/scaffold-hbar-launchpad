"use client";

import { useState } from "react";
import { type Address, formatUnits } from "viem";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { AssociationNotice } from "~~/components/launchpad/AssociationNotice";
import { QuoteRows } from "~~/components/launchpad/CurveTradePanel";
import { useTokenAssociation } from "~~/hooks/launchpad/useTokenAssociation";
import {
  useDeployedContractInfo,
  useScaffoldReadContract,
  useScaffoldWriteContract,
  useTransactor,
} from "~~/hooks/scaffold-hbar";
import { htsTokenAbi } from "~~/utils/launchpad/htsToken";
import {
  TOKEN_DECIMALS,
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

type Mode = "buy" | "sell";

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
  const [mode, setMode] = useState<Mode>("buy");
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

  const { data: tokenBalance, refetch: refetchBalance } = useReadContract({
    address: token,
    abi: htsTokenAbi,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: token,
    abi: htsTokenAbi,
    functionName: "allowance",
    args: account && router ? [account, router.address] : undefined,
  });

  const association = useTokenAssociation(token);
  const { writeContractAsync: writeRouter, isMining } = useScaffoldWriteContract({ contractName: "SaucerSwapRouter" });
  const { writeContractAsync: writeToken, isPending: isApproving } = useWriteContract();
  const transactor = useTransactor();

  const needsApproval = mode === "sell" && hasAmount && (allowance ?? 0n) < amount;
  const insufficientTokens = mode === "sell" && hasAmount && (tokenBalance ?? 0n) < amount;
  const deadline = () => BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);

  const afterTrade = () => {
    setInput("");
    refetchBalance();
    refetchAllowance();
    onTrade();
  };

  const swap = async () => {
    if (!account || !hasAmount || amountOut === undefined) return;
    const minOut = withSlippage(amountOut, SLIPPAGE_BPS);
    if (mode === "buy") {
      await writeRouter(
        {
          functionName: "swapExactETHForTokens",
          args: [minOut, path, account, deadline()],
          value: tinybarsToWeibars(amount),
        },
        { onBlockConfirmation: afterTrade },
      );
    } else {
      await writeRouter(
        { functionName: "swapExactTokensForETH", args: [amount, minOut, path, account, deadline()] },
        { onBlockConfirmation: afterTrade },
      );
    }
  };

  const approve = async () => {
    if (!hasAmount || !router) return;
    await transactor(() =>
      writeToken({ address: token, abi: htsTokenAbi, functionName: "approve", args: [router.address, amount] }),
    );
    refetchAllowance();
  };

  return (
    <div className="bg-base-100 rounded-2xl border border-success/40 p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold m-0">Trade on SaucerSwap</h3>
        <span className="badge badge-success badge-sm whitespace-nowrap">Liquidity locked</span>
      </div>
      <div role="tablist" className="tabs tabs-box">
        {(["buy", "sell"] as const).map(tab => (
          <button
            key={tab}
            role="tab"
            className={`tab flex-1 capitalize ${mode === tab ? "tab-active" : ""}`}
            onClick={() => {
              setMode(tab);
              setInput("");
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-base-content/60 flex justify-between">
          <span>{mode === "buy" ? "You pay (HBAR)" : `You sell (${symbol})`}</span>
          {mode === "sell" && tokenBalance !== undefined && (
            <button className="link link-hover" onClick={() => setInput(formatUnits(tokenBalance, TOKEN_DECIMALS))}>
              Balance: {formatTokens(tokenBalance)}
            </button>
          )}
        </span>
        <input
          className="input input-bordered w-full text-lg"
          inputMode="decimal"
          placeholder="0.0"
          value={input}
          onChange={e => setInput(e.target.value.replace(/[^0-9.]/g, ""))}
        />
      </label>

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
      ) : needsApproval ? (
        <button className="btn btn-secondary" disabled={isApproving || insufficientTokens} onClick={approve}>
          {isApproving ? <span className="loading loading-spinner loading-sm" /> : `Approve ${symbol} for SaucerSwap`}
        </button>
      ) : (
        <button
          className="btn btn-success"
          disabled={!account || !hasAmount || amountOut === undefined || isMining || insufficientTokens}
          onClick={swap}
        >
          {isMining ? (
            <span className="loading loading-spinner loading-sm" />
          ) : insufficientTokens ? (
            "Insufficient balance"
          ) : (
            "Swap"
          )}
        </button>
      )}
    </div>
  );
};
