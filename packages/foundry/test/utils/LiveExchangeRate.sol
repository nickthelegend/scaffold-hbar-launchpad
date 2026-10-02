// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IExchangeRate } from "../../contracts/interfaces/IExchangeRate.sol";

/// @notice Hedera's exchange rate system contract (0x168) for forked tests, using the network's live rate.
/// @dev System contracts are native to Hedera nodes, so a Foundry fork has no code at 0x168. `ForkTestBase` etches
///      this contract there and loads the current rate from the mirror node (`/network/exchangerate`), so SaucerSwap's
///      USD-denominated fees and the Launchpad's quotes are computed exactly as on the real network.
contract LiveExchangeRate is IExchangeRate {
    uint256 public centEquivalent;
    uint256 public hbarEquivalent;

    function setRate(uint256 centEquivalent_, uint256 hbarEquivalent_) external {
        centEquivalent = centEquivalent_;
        hbarEquivalent = hbarEquivalent_;
    }

    /// Same conversion the network performs: `hbarEquivalent` HBAR buy `centEquivalent` cents.
    function tinycentsToTinybars(uint256 tinycents) external view returns (uint256) {
        return (tinycents * hbarEquivalent) / centEquivalent;
    }

    function tinybarsToTinycents(uint256 tinybars) external view returns (uint256) {
        return (tinybars * centEquivalent) / hbarEquivalent;
    }
}
