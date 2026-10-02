"use client";

import { useState } from "react";
import { type Address, formatUnits } from "viem";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { AssociationNotice } from "~~/components/launchpad/AssociationNotice";
import { useTokenAssociation } from "~~/hooks/launchpad/useTokenAssociation";
import { useScaffoldReadContract, useScaffoldWriteContract, useTransactor } from "~~/hooks/scaffold-hbar";
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

type Mode = "buy" | "sell";

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
  const [mode, setMode] = useState<Mode>("buy");
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
    args: account ? [account, launchpad] : undefined,
  });

  const association = useTokenAssociation(token);
  const { writeContractAsync: writeLaunchpad, isMining } = useScaffoldWriteContract({ contractName: "Launchpad" });
  const { writeContractAsync: writeToken, isPending: isApproving } = useWriteContract();
  const transactor = useTransactor();

  const needsApproval = mode === "sell" && hasAmount && (allowance ?? 0n) < amount;
  const insufficientTokens = mode === "sell" && hasAmount && (tokenBalance ?? 0n) < amount;

  const afterTrade = () => {
    setInput("");
    refetchBalance();
    refetchAllowance();
    onTrade();
  };

  const buy = async () => {
    if (!buyQuote || !hasAmount) return;
    const [tokensOut] = buyQuote;
    await writeLaunchpad(
      {
        functionName: "buy",
        args: [token, withSlippage(tokensOut, SLIPPAGE_BPS)],
        // `value` goes over JSON-RPC, so it is in weibars; the contract sees tinybars.
        value: tinybarsToWeibars(amount),
      },
      { onBlockConfirmation: afterTrade },
    );
  };

  const approve = async () => {
    if (!hasAmount) return;
    await transactor(() =>
      writeToken({ address: token, abi: htsTokenAbi, functionName: "approve", args: [launchpad, amount] }),
    );
    refetchAllowance();
  };

  const sell = async () => {
    if (!sellQuote || !hasAmount) return;
    const [hbarOut] = sellQuote;
    await writeLaunchpad(
      { functionName: "sell", args: [token, amount, withSlippage(hbarOut, SLIPPAGE_BPS)] },
      { onBlockConfirmation: afterTrade },
    );
  };

  return (
    <div className="bg-base-100 rounded-2xl border border-base-300 p-5 flex flex-col gap-4">
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

      {mode === "buy" && buyQuote && hasAmount && (
        <QuoteRows
          rows={[
            ["You receive", `${formatTokens(buyQuote[0])} ${symbol}`],
            ["Fee (1%)", `${formatHbar(buyQuote[1])} HBAR`],
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
            ["Fee (1%)", `${formatHbar(sellQuote[1])} HBAR`],
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
        <button className="btn btn-primary" disabled={!account || !hasAmount || !buyQuote || isMining} onClick={buy}>
          {isMining ? <span className="loading loading-spinner loading-sm" /> : account ? "Buy" : "Connect a wallet"}
        </button>
      ) : needsApproval ? (
        <button className="btn btn-secondary" disabled={isApproving || insufficientTokens} onClick={approve}>
          {isApproving ? <span className="loading loading-spinner loading-sm" /> : `Approve ${symbol}`}
        </button>
      ) : (
        <button
          className="btn btn-primary"
          disabled={!account || !hasAmount || !sellQuote || isMining || insufficientTokens}
          onClick={sell}
        >
          {isMining ? (
            <span className="loading loading-spinner loading-sm" />
          ) : insufficientTokens ? (
            "Insufficient balance"
          ) : (
            "Sell"
          )}
        </button>
      )}
      <p className="text-xs text-base-content/50 m-0">Slippage tolerance 1%. Prices are set by the bonding curve.</p>
    </div>
  );
};

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
