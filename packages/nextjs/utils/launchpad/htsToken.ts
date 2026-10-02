import { erc20Abi, parseAbi } from "viem";

/**
 * HTS tokens are not ERC-20 contracts, but the network exposes an ERC-20 facade at each token's
 * address (HIP-218/HIP-376) plus HRC-719 association functions (HIP-719). One ABI covers both.
 */
export const htsTokenAbi = [
  ...erc20Abi,
  ...parseAbi([
    "function associate() returns (uint256 responseCode)",
    "function isAssociated() view returns (bool associated)",
  ]),
] as const;
