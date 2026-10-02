//SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { ScaffoldETHDeploy } from "./DeployHelpers.s.sol";
import { Launchpad } from "../contracts/Launchpad.sol";
import { ISaucerSwapV1Router } from "../contracts/interfaces/ISaucerSwapV1.sol";

/**
 * @notice Deploys the Launchpad wired to SaucerSwap V1 on the current Hedera network.
 * @dev Usage: yarn deploy --network hedera_testnet
 *
 * Optional environment variables (packages/foundry/.env):
 *   GRADUATION_THRESHOLD_HBAR  HBAR a curve must raise before graduating (default: 100)
 *   FEE_RECIPIENT              Address receiving the 1% trading fee (default: deployer)
 */
contract DeployScript is ScaffoldETHDeploy {
    error UnsupportedChain(uint256 chainId);

    /// SaucerSwap V1 RouterV3 — https://docs.saucerswap.finance/developerx/contract-deployments
    address internal constant SAUCERSWAP_ROUTER_TESTNET = 0x0000000000000000000000000000000000004b40; // 0.0.19264
    address internal constant SAUCERSWAP_ROUTER_MAINNET = 0x00000000000000000000000000000000002E7A5D; // 0.0.3045981

    uint256 internal constant TINYBARS_PER_HBAR = 1e8;

    function run() external ScaffoldEthDeployerRunner {
        uint256 thresholdHbar = vm.envOr("GRADUATION_THRESHOLD_HBAR", uint256(100));
        address feeRecipient = vm.envOr("FEE_RECIPIENT", deployer);

        Launchpad launchpad =
            new Launchpad(ISaucerSwapV1Router(saucerSwapRouter()), feeRecipient, thresholdHbar * TINYBARS_PER_HBAR);
        deployments.push(Deployment({ name: "Launchpad", addr: address(launchpad) }));
    }

    function saucerSwapRouter() internal view returns (address) {
        if (block.chainid == 296) return SAUCERSWAP_ROUTER_TESTNET;
        if (block.chainid == 295) return SAUCERSWAP_ROUTER_MAINNET;
        revert UnsupportedChain(block.chainid);
    }
}
