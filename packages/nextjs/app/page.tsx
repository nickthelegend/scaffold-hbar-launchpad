"use client";

import Link from "next/link";
import type { NextPage } from "next";
import { RocketLaunchIcon } from "@heroicons/react/24/outline";
import { LaunchCard } from "~~/components/launchpad/LaunchCard";
import { useLaunchpad } from "~~/hooks/launchpad/useLaunchpad";
import { useScaffoldReadContract } from "~~/hooks/scaffold-hbar";
import { formatHbar } from "~~/utils/launchpad/units";

const PAGE_SIZE = 30n;

const steps = [
  [
    "Launch",
    "Mint a fixed-supply HTS token with no mint or admin keys. Its SaucerSwap pool is created, and frozen, in the same tx.",
  ],
  ["Trade the curve", "80% of supply sells on a bonding curve priced in HBAR. Buy or sell any time."],
  ["Graduate", "At the threshold, raised HBAR + 20% of supply seed SaucerSwap. LP tokens are locked forever."],
] as const;

const Home: NextPage = () => {
  const { threshold, isDeployed, isLoading: isCheckingDeployment } = useLaunchpad();
  const { data } = useScaffoldReadContract({
    contractName: "Launchpad",
    functionName: "getLaunches",
    args: [0n, PAGE_SIZE],
  });
  const [tokens, launches] = data ?? [[], []];

  return (
    <div className="flex flex-col grow">
      <section className="hedera-gradient dark:bg-none dark:bg-hedera-charcoal px-5 py-14 text-white">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row gap-10 items-start md:items-center">
          <div className="flex-1">
            <p className="uppercase tracking-widest text-xs text-white/70 m-0 mb-3">HTS · SaucerSwap · HCS</p>
            <h1 className="text-4xl md:text-5xl font-bold m-0 leading-tight">Fair-launch tokens on Hedera.</h1>
            <p className="text-white/80 mt-4 mb-6 max-w-lg">
              Launch on a bonding curve, graduate into a SaucerSwap pool with locked liquidity. No presale, no team
              allocation, no mint keys.
            </p>
            <Link href="/create" className="btn btn-lg bg-white text-black border-0 hover:bg-white/90 gap-2">
              <RocketLaunchIcon className="h-5 w-5" /> Launch a token
            </Link>
          </div>
          <ol className="flex-1 flex flex-col gap-3 m-0 p-0 list-none">
            {steps.map(([title, body], i) => (
              <li key={title} className="bg-white/10 rounded-xl p-4 flex gap-3">
                <span className="font-bold text-lg leading-none">{i + 1}</span>
                <div>
                  <p className="font-semibold m-0">{title}</p>
                  <p className="text-sm text-white/75 m-0">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="max-w-5xl w-full mx-auto px-5 py-10">
        <div className="flex items-baseline justify-between mb-5">
          <h2 className="text-2xl font-bold m-0">Latest launches</h2>
          {threshold !== undefined && (
            <span className="text-sm text-base-content/60">Graduation at {formatHbar(threshold, 0)} HBAR</span>
          )}
        </div>

        {!isCheckingDeployment && !isDeployed ? (
          <div className="alert">
            No Launchpad deployment found for this network. Run <code>yarn deploy --network hedera_testnet</code>.
          </div>
        ) : isCheckingDeployment || !data || threshold === undefined ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[0, 1, 2].map(i => (
              <div key={i} className="h-48 rounded-2xl bg-base-200 animate-pulse" />
            ))}
          </div>
        ) : tokens.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-base-300 rounded-2xl">
            <p className="m-0 mb-4 text-base-content/60">No launches yet.</p>
            <Link href="/create" className="btn btn-primary">
              Be the first
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {tokens.map((token, i) => (
              <LaunchCard key={token} token={token} launch={launches[i]} threshold={threshold} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default Home;
