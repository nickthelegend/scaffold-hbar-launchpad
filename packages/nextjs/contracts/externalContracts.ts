/**
 * This file contains external contract definitions (contracts not deployed by this project).
 * Add entries here to interact with pre-deployed contracts on any supported chain.
 */
import { GenericContractsDeclaration } from "~~/utils/scaffold-hbar/contract";

/**
 * SaucerSwap V1 RouterV3 — the subset of its ABI the launchpad UI uses to trade graduated tokens.
 * Addresses: https://docs.saucerswap.finance/developerx/contract-deployments
 */
const saucerSwapRouterAbi = [
  {
    type: "function",
    name: "getAmountsOut",
    stateMutability: "view",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "path", type: "address[]" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "swapExactETHForTokens",
    stateMutability: "payable",
    inputs: [
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "swapExactTokensForETH",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
] as const;

const externalContracts = {
  296: {
    SaucerSwapRouter: { address: "0x0000000000000000000000000000000000004b40", abi: saucerSwapRouterAbi }, // 0.0.19264
  },
  295: {
    SaucerSwapRouter: { address: "0x00000000000000000000000000000000002E7A5D", abi: saucerSwapRouterAbi }, // 0.0.3045981
  },
} as const;

export default externalContracts satisfies GenericContractsDeclaration;
