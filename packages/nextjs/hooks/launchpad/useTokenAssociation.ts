import { useLaunchpad } from "./useLaunchpad";
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { useTransactor } from "~~/hooks/scaffold-hbar";
import { hasOnChainActivity } from "~~/hooks/scaffold-hbar/useHederaAccountId";
import { htsTokenAbi } from "~~/utils/launchpad/htsToken";

/**
 * On Hedera an account must be associated with an HTS token before it can hold it, unless it has
 * automatic association slots (wallet-created EVM accounts get unlimited slots by default, HIP-904).
 * This hook reports whether the connected account can receive `token` and exposes the HIP-719
 * `associate()` call on the token's own address.
 */
export function useTokenAssociation(token: Address | undefined) {
  const { address: account } = useAccount();
  const { chainId, mirror } = useLaunchpad();
  const { writeContractAsync, isPending } = useWriteContract();
  const transactor = useTransactor();
  const publicClient = usePublicClient({ chainId });

  const status = useQuery({
    queryKey: ["association", chainId, account, token],
    // A brand-new address has no Hedera account yet (it is created by the first HBAR it receives): skip the lookup.
    queryFn: async () =>
      (await hasOnChainActivity(publicClient, account!)) ? mirror.getAssociationStatus(account!, token!) : null,
    enabled: Boolean(account && token),
  });

  const associate = async () => {
    if (!token) return;
    await transactor(() => writeContractAsync({ address: token, abi: htsTokenAbi, functionName: "associate" }));
    // The mirror node trails consensus by a few seconds.
    setTimeout(() => status.refetch(), 4_000);
  };

  const canReceive = status.data ? status.data.associated || status.data.autoAssociates : undefined;

  return { canReceive, isChecking: status.isLoading, associate, isAssociating: isPending };
}
