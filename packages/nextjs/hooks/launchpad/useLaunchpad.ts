import { useMemo } from "react";
import { useDeployedContractInfo, useScaffoldReadContract, useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { MirrorNodeClient } from "~~/utils/launchpad/mirror";

/** Shared context for launchpad hooks: deployed address, graduation threshold and a mirror node client. */
export function useLaunchpad() {
  const { targetNetwork } = useTargetNetwork();
  const { data: contract, isLoading } = useDeployedContractInfo({ contractName: "Launchpad" });
  // Immutable values: read once instead of on every block.
  const { data: threshold } = useScaffoldReadContract({
    contractName: "Launchpad",
    functionName: "graduationThreshold",
    watch: false,
  });
  const { data: whbar } = useScaffoldReadContract({ contractName: "Launchpad", functionName: "whbar", watch: false });
  const mirror = useMemo(() => MirrorNodeClient.forChain(targetNetwork.id), [targetNetwork.id]);

  return {
    launchpadAddress: contract?.address,
    isDeployed: !isLoading && Boolean(contract),
    chainId: targetNetwork.id,
    threshold,
    whbar,
    mirror,
  };
}
