// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice HTS freeze functions (system contract 0x167). Must be called by the token's freeze key.
/// @dev A frozen account can neither send nor receive the token (ACCOUNT_FROZEN_FOR_TOKEN).
interface IHtsFreeze {
    function freezeToken(address token, address account) external returns (int64 responseCode);

    function unfreezeToken(address token, address account) external returns (int64 responseCode);
}
