import { useMemo } from "react";
import { useDeployedContractInfo, useScaffoldReadContract, useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { MirrorNodeClient } from "~~/utils/launchpad/mirror";

/** Shared context for launchpad hooks: deployed address, graduation threshold and a mirror node client. */
export function useLaunchpad() {
  const { targetNetwork } = useTargetNetwork();
  const { data: contract, isLoading } = useDeployedContractInfo({ contractName: "Launchpad" });
  const { data: threshold } = useScaffoldReadContract({
    contractName: "Launchpad",
    functionName: "graduationThreshold",
  });
  const { data: whbar } = useScaffoldReadContract({ contractName: "Launchpad", functionName: "whbar" });
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
