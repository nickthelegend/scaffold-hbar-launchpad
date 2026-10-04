"use client";

import { type CSSProperties, useState } from "react";
import { type Address, formatEther } from "viem";
import { useBalance } from "wagmi";
import { useFetchHbarPrice, useTargetNetwork } from "~~/hooks/scaffold-hbar";

/**
 * HBAR balance of `address`; click to toggle USD. Same behaviour as `@scaffold-hbar-ui/components`' Balance, but
 * priced from Hedera's own exchange rate (`useFetchHbarPrice`) instead of a rate-limited public price API.
 */
export const Balance = ({ address, style }: { address: Address; style?: CSSProperties }) => {
  const { targetNetwork } = useTargetNetwork();
  const { data: balance, isLoading } = useBalance({
    address,
    chainId: targetNetwork.id,
    query: { refetchInterval: 10_000 },
  });
  const { price } = useFetchHbarPrice();
  const [usdMode, setUsdMode] = useState(false);

  if (isLoading || !balance) {
    return (
      <div className="flex items-center animate-pulse" style={style}>
        <div className="h-4 w-20 bg-base-300 rounded" />
      </div>
    );
  }

  const hbar = Number(formatEther(balance.value));
  const canShowUsd = price > 0;
  return (
    <button
      type="button"
      className="flex items-center font-normal bg-transparent focus:outline-none cursor-pointer"
      onClick={() => canShowUsd && setUsdMode(mode => !mode)}
      title={canShowUsd ? "Toggle balance display mode" : undefined}
      style={style}
    >
      {usdMode && canShowUsd ? (
        <>
          <span className="text-xs font-bold mr-1">$</span>
          <span>{(hbar * price).toFixed(2)}</span>
        </>
      ) : (
        <>
          <span>{hbar.toFixed(4)}</span>
          <span className="text-xs font-bold ml-1">{targetNetwork.nativeCurrency.symbol}</span>
        </>
      )}
    </button>
  );
};
