import type { Address } from "viem";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { useTransactor } from "~~/hooks/scaffold-hbar";
import { htsTokenAbi } from "~~/utils/launchpad/htsToken";

/**
 * Balance of the connected account in an HTS token, its allowance for `spender`, and an `approve` action.
 * HTS allowances work through the token's ERC-20 facade (HIP-376); they are needed before a contract can pull
 * tokens, e.g. the Launchpad on `sell` or the SaucerSwap router on a swap.
 */
export function useHtsAllowance(token: Address, spender: Address | undefined) {
  const { address: account } = useAccount();
  const { writeContractAsync, isPending: isApproving } = useWriteContract();
  const transactor = useTransactor();

  const { data: balance, refetch: refetchBalance } = useReadContract({
    address: token,
    abi: htsTokenAbi,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: token,
    abi: htsTokenAbi,
    functionName: "allowance",
    args: account && spender ? [account, spender] : undefined,
  });

  const approve = async (amount: bigint) => {
    if (!spender) return;
    await transactor(() =>
      writeContractAsync({ address: token, abi: htsTokenAbi, functionName: "approve", args: [spender, amount] }),
    );
    await refetchAllowance();
  };

  const refetch = () => Promise.all([refetchBalance(), refetchAllowance()]);

  return { balance, allowance: allowance ?? 0n, approve, isApproving, refetch };
}
