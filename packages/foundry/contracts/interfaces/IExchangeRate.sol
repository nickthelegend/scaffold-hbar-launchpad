// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Hedera exchange rate system contract (HIP-475), deployed at 0x168.
/// @dev Converts USD-denominated fees to HBAR using the network's exchange rate file (0.0.112).
///      Declared `view` so quotes can be served through `eth_call`; the system contract is read-only.
interface IExchangeRate {
    /// Converts tinycents (1e-8 US cents) to tinybars (1e-8 HBAR).
    function tinycentsToTinybars(uint256 tinycents) external view returns (uint256);
}
