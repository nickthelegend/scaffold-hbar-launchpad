import { useLaunchpad } from "./useLaunchpad";
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { toPricePoints } from "~~/utils/launchpad/activity";

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

/** Trades, graduation and pool price history for a launch, refreshed every 10 seconds. */
export function useLaunchActivity(
  token: Address | undefined,
  launch: { createdAt: bigint; pair: Address; graduated: boolean } | undefined,
) {
  const { launchpadAddress, chainId, mirror, threshold, whbar } = useLaunchpad();

  return useQuery({
    queryKey: ["launch-activity", chainId, token, launch?.graduated],
    enabled: Boolean(launchpadAddress && token && launch && threshold && whbar),
    refetchInterval: 10_000,
    queryFn: async () => {
      const since = Number(launch!.createdAt);
      const [trades, graduation] = await Promise.all([
        mirror.getTrades(launchpadAddress!, token!, since),
        launch!.graduated ? mirror.getGraduation(launchpadAddress!, token!, since) : Promise.resolve(null),
      ]);
      // Before graduation the pair exists but is empty; only read its history afterwards.
      const syncs = graduation ? await mirror.getPoolSyncs(launch!.pair, graduation.timestamp) : [];
      return {
        trades,
        graduation,
        pricePoints: toPricePoints(threshold!, trades, syncs, token!, whbar!),
      };
    },
  });
}
