"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import type { NextPage } from "next";
import { type Address, isAddress } from "viem";
import { AccountLabel } from "~~/components/launchpad/AccountLabel";
import { CommentsThread } from "~~/components/launchpad/CommentsThread";
import { CurveTradePanel } from "~~/components/launchpad/CurveTradePanel";
import { GraduationProgress } from "~~/components/launchpad/GraduationProgress";
import { HashscanLink } from "~~/components/launchpad/HashscanLink";
import { PriceChart } from "~~/components/launchpad/PriceChart";
import { SaucerSwapTradePanel } from "~~/components/launchpad/SaucerSwapTradePanel";
import { TokenAvatar } from "~~/components/launchpad/TokenAvatar";
import { TradesTable } from "~~/components/launchpad/TradesTable";
import { useLaunchActivity, useLaunchMetadata } from "~~/hooks/launchpad/useLaunchData";
import { useLaunchpad } from "~~/hooks/launchpad/useLaunchpad";
import { useScaffoldReadContract } from "~~/hooks/scaffold-hbar";
import { curveVolume } from "~~/utils/launchpad/activity";
import { hbarToPrice, marketCap, priceToHbar, spotPrice } from "~~/utils/launchpad/curve";
import { toEntityId } from "~~/utils/launchpad/mirror";
import { formatHbar } from "~~/utils/launchpad/units";

const TokenPage: NextPage = () => {
  const params = useParams<{ address: string }>();
  const token = isAddress(params.address) ? (params.address as Address) : undefined;
  const { launchpadAddress, threshold, whbar, chainId } = useLaunchpad();

  const {
    data: launch,
    error,
    refetch: refetchLaunch,
  } = useScaffoldReadContract({ contractName: "Launchpad", functionName: "getLaunch", args: [token] });
  const { data: metadata } = useLaunchMetadata(token, launch?.createdAt);
  const { data: activity, refetch: refetchActivity } = useLaunchActivity(token, launch);

  if (!token || error) {
    return (
      <div className="max-w-xl mx-auto px-5 py-16 text-center">
        <h1 className="text-2xl font-bold">Launch not found</h1>
        <p className="text-base-content/60">This address is not a token created by this launchpad.</p>
        <Link href="/" className="btn btn-primary">
          Back to launches
        </Link>
      </div>
    );
  }

  if (!launch || threshold === undefined || !launchpadAddress || !whbar) {
    return (
      <div className="flex justify-center py-20">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }

  const symbol = metadata?.symbol ?? "TOKEN";
  const lastPoint = activity?.pricePoints.at(-1);
  // After graduation the curve is closed; the latest SaucerSwap pool price is the live price.
  const price = launch.graduated
    ? lastPoint
      ? hbarToPrice(lastPoint.price)
      : undefined
    : spotPrice(threshold, launch);
  const onTrade = () => {
    refetchLaunch();
    // The mirror node trails consensus by a few seconds.
    setTimeout(() => refetchActivity(), 4_000);
  };
  const saucerSwapUrl =
    chainId === 295
      ? `https://www.saucerswap.finance/swap/HBAR/${toEntityId(token)}`
      : `https://testnet.saucerswap.finance/swap/HBAR/${toEntityId(token)}`;

  return (
    <div className="max-w-6xl w-full mx-auto px-5 py-8 flex flex-col gap-6">
      <header className="flex flex-col md:flex-row gap-5 md:items-center">
        <TokenAvatar imageUri={metadata?.imageUri} symbol={metadata?.symbol} size={80} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold m-0">{metadata?.name ?? "…"}</h1>
            <span className="badge badge-outline">${symbol}</span>
            {launch.graduated && <span className="badge badge-success">Graduated</span>}
          </div>
          {metadata?.description && <p className="text-base-content/70 m-0 mt-2">{metadata.description}</p>}
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm mt-2 text-base-content/70">
            <span className="inline-flex items-center gap-1">
              Creator <AccountLabel address={launch.creator} />
            </span>
            <HashscanLink path={`token/${toEntityId(token)}`} label={`HTS ${toEntityId(token)}`} />
            <HashscanLink path={`contract/${launch.pair}`} label="SaucerSwap pair" />
          </div>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Price" value={price !== undefined ? `${formatPrice(priceToHbar(price))} HBAR` : "—"} />
        <Stat label="Market cap" value={price !== undefined ? `${formatHbar(marketCap(price), 0)} HBAR` : "—"} />
        <Stat label="Curve volume" value={activity ? `${formatHbar(curveVolume(activity.trades), 2)} HBAR` : "—"} />
        <Stat label="Trades" value={activity ? String(activity.trades.length) : "—"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 flex flex-col gap-6">
          <PriceChart points={activity?.pricePoints ?? []} />
          <TradesTable trades={activity?.trades ?? []} symbol={symbol} />
          <CommentsThread token={token} />
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-4">
          <div className="bg-base-100 rounded-2xl border border-base-300 p-5">
            <GraduationProgress hbarRaised={launch.hbarRaised} threshold={threshold} graduated={launch.graduated} />
            {activity?.graduation && (
              <p className="text-xs text-base-content/70 m-0 mt-2">
                Seeded {formatHbar(activity.graduation.hbarLiquidity, 2)} HBAR of liquidity.{" "}
                <HashscanLink path={`transaction/${activity.graduation.transactionHash}`} label="Graduation tx" />
              </p>
            )}
          </div>
          {launch.graduated ? (
            <>
              <SaucerSwapTradePanel token={token} symbol={symbol} whbar={whbar} onTrade={onTrade} />
              <a href={saucerSwapUrl} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm">
                Open in SaucerSwap
              </a>
            </>
          ) : (
            <CurveTradePanel token={token} symbol={symbol} launchpad={launchpadAddress} onTrade={onTrade} />
          )}
        </aside>
      </div>
    </div>
  );
};

/** Token prices are tiny (e.g. 0.000000012 HBAR); show three significant digits. */
const formatPrice = (hbar: number) => (hbar < 0.001 ? hbar.toPrecision(3) : hbar.toFixed(4));

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="bg-base-100 rounded-xl border border-base-300 p-3">
    <p className="text-xs text-base-content/60 m-0">{label}</p>
    <p className="font-semibold m-0 truncate">{value}</p>
  </div>
);

export default TokenPage;
