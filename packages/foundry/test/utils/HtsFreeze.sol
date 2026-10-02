// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Storage layout for HTS freeze state in the fork emulator, shared by `HtsV1Compat` (writes) and
///         `HtsContractKeyRouter` (enforces). Kept in each token's own storage, like the emulator's balances.
library HtsFreeze {
    /// HTS response code returned when a frozen account sends or receives the token.
    int64 internal constant ACCOUNT_FROZEN_FOR_TOKEN = 165;
    int64 internal constant TOKEN_HAS_NO_FREEZE_KEY = 172;
    int64 internal constant INVALID_SIGNATURE = 7;
    uint256 internal constant FREEZE_KEY_TYPE = 4;

    function slot(address account) internal pure returns (bytes32) {
        return keccak256(abi.encode("hts.fork.frozen", account));
    }
}
