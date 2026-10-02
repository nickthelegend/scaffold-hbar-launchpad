import Link from "next/link";
import { GraduationProgress } from "./GraduationProgress";
import { TokenAvatar } from "./TokenAvatar";
import type { Address } from "viem";
import { useLaunchMetadata } from "~~/hooks/launchpad/useLaunchData";
import { marketCap, spotPrice } from "~~/utils/launchpad/curve";
import { formatHbar } from "~~/utils/launchpad/units";

export type LaunchView = {
  creator: Address;
  pair: Address;
  lpToken: Address;
  createdAt: bigint;
  graduated: boolean;
  hbarRaised: bigint;
  tokensLeft: bigint;
};

export const LaunchCard = ({ token, launch, threshold }: { token: Address; launch: LaunchView; threshold: bigint }) => {
  const { data: metadata } = useLaunchMetadata(token, launch.createdAt);
  const cap = launch.graduated ? undefined : marketCap(spotPrice(threshold, launch));

  return (
    <Link
      href={`/token/${token}`}
      className="bg-base-100 rounded-2xl border border-base-300 p-5 flex flex-col gap-4 hover:shadow-lg hover:border-primary/40 transition-all"
    >
      <div className="flex gap-3 items-start">
        <TokenAvatar imageUri={metadata?.imageUri} symbol={metadata?.symbol} size={56} />
        <div className="min-w-0">
          <h3 className="font-bold text-lg m-0 truncate">{metadata?.name ?? "Loading…"}</h3>
          <p className="text-sm text-base-content/60 m-0">${metadata?.symbol ?? "…"}</p>
          {cap !== undefined && <p className="text-xs text-base-content/60 m-0 mt-1">MC {formatHbar(cap, 0)} HBAR</p>}
        </div>
        {launch.graduated && <span className="badge badge-success badge-sm ml-auto shrink-0">SaucerSwap</span>}
      </div>
      {metadata?.description && <p className="text-sm text-base-content/80 m-0 line-clamp-2">{metadata.description}</p>}
      <div className="mt-auto">
        <GraduationProgress hbarRaised={launch.hbarRaised} threshold={threshold} graduated={launch.graduated} compact />
      </div>
    </Link>
  );
};
