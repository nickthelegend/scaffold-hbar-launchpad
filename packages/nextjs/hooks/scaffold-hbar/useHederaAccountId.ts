import { useEffect, useState } from "react";
import type { Address } from "viem";
import { usePublicClient } from "wagmi";
import { chainIdToHederaNetwork, getHederaAccountId } from "~~/utils/scaffold-hbar";

export function useHederaAccountId(evmAddress: string | undefined, chainId?: number) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const publicClient = usePublicClient({ chainId });

  useEffect(() => {
    if (!evmAddress) {
      setAccountId(null);
      return;
    }

    let cancelled = false;
    const network = chainIdToHederaNetwork(chainId ?? 296);

    setIsLoading(true);

    // An address that has never held HBAR or sent a transaction has no Hedera account yet; skip the mirror-node
    // lookup instead of letting it 404 in the console.
    hasOnChainActivity(publicClient, evmAddress as Address)
      .then(active => (active ? getHederaAccountId(evmAddress, network) : null))
      .then(id => {
        if (!cancelled) setAccountId(id);
      })
      .catch(() => {
        if (!cancelled) setAccountId(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [evmAddress, chainId, publicClient]);

  return { accountId, isLoading };
}

type PublicClient = ReturnType<typeof usePublicClient>;

/** True if the address holds HBAR or has sent a transaction; without a client, assume it might. */
export async function hasOnChainActivity(publicClient: PublicClient, address: Address): Promise<boolean> {
  if (!publicClient) return true;
  const [balance, nonce] = await Promise.all([
    publicClient.getBalance({ address }),
    publicClient.getTransactionCount({ address }),
  ]);
  return balance > 0n || nonce > 0;
}
