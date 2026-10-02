import { useLaunchpad } from "./useLaunchpad";
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { poolPriceAt, toPricePoints } from "~~/utils/launchpad/activity";

const REFRESH_MS = 10_000;

/** Launch metadata (name, image, description) from the `LaunchCreated` event. Immutable, so cached forever. */
export function useLaunchMetadata(token: Address | undefined, createdAt: bigint | undefined) {
  const { launchpadAddress, chainId, mirror } = useLaunchpad();
  return useQuery({
    queryKey: ["launch-metadata", chainId, token],
    queryFn: () => mirror.getLaunchMetadata(launchpadAddress!, token!, Number(createdAt)),
    enabled: Boolean(launchpadAddress && token && createdAt),
    staleTime: Infinity,
  });
}

/**
 * Price history for a launch: curve trades (polled until graduation, then final) followed by SaucerSwap pool
 * updates (polled after graduation). Returns chart points plus the latest pool price, kept as a scaled bigint.
 */
export function useLaunchActivity(
  token: Address | undefined,
  launch: { createdAt: bigint; pair: Address; graduated: boolean } | undefined,
) {
  const { launchpadAddress, chainId, mirror, threshold, whbar } = useLaunchpad();
  const graduated = launch?.graduated ?? false;
  const since = Number(launch?.createdAt ?? 0);

  const curve = useQuery({
    queryKey: ["launch-curve", chainId, token, graduated],
    enabled: Boolean(launchpadAddress && token && launch),
    // The curve's history is final once the launch has graduated.
    refetchInterval: graduated ? false : REFRESH_MS,
    staleTime: graduated ? Infinity : 0,
    queryFn: async () => {
      const [trades, graduation] = await Promise.all([
        mirror.getTrades(launchpadAddress!, token!, since),
        graduated ? mirror.getGraduation(launchpadAddress!, token!, since) : Promise.resolve(null),
      ]);
      return { trades, graduation };
    },
  });

  const graduationTime = curve.data?.graduation?.timestamp;
  const pool = useQuery({
    queryKey: ["launch-pool", chainId, launch?.pair, graduationTime],
    enabled: Boolean(launch && graduationTime),
    refetchInterval: REFRESH_MS,
    queryFn: () => mirror.getPoolSyncs(launch!.pair, graduationTime!),
  });

  const ready = curve.data && threshold !== undefined && whbar;
  const syncs = pool.data ?? [];
  return {
    trades: curve.data?.trades,
    graduation: curve.data?.graduation ?? null,
    pricePoints: ready ? toPricePoints(threshold, curve.data!.trades, syncs, token!, whbar) : [],
    latestPoolPrice: ready && syncs.length > 0 ? poolPriceAt(syncs[syncs.length - 1], token!, whbar) : undefined,
    refetch: () => Promise.all([curve.refetch(), pool.refetch()]),
  };
}
