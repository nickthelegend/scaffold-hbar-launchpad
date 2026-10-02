// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Vm } from "forge-std/Vm.sol";
import { IHederaTokenService } from "hedera-forking/IHederaTokenService.sol";
import { ContractKeys } from "./ContractKeys.sol";

/// @notice Front for the HTS emulator at 0x167 that honours contract keys on associations.
/// @dev On Hedera a contract may associate *another* account if that account's key contains the contract's ID
///      (`ContractID` key). SaucerSwap's factory relies on this to associate its `feeTo` account (whose threshold key
///      includes the factory) with every new LP token. hedera-forking only accepts `account == msg.sender`, so this
///      front checks the account's real key on the mirror node and, when it is keyed by the caller, records the
///      association through the token exactly as the emulator would. Every other call is delegated to the emulator,
///      keeping 0x167's storage and `address(this)` intact.
contract HtsContractKeyRouter {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address internal immutable emulator;

    constructor(address emulator_) {
        emulator = emulator_;
    }

    fallback() external payable {
        if (msg.sig == IHederaTokenService.associateToken.selector && address(this) == address(0x167)) {
            (address account, address token) = abi.decode(msg.data[4:], (address, address));
            if (
                account != msg.sender
                    && ContractKeys.keyedBy(string.concat("accounts/", vm.toString(account)), ".key.key", msg.sender)
            ) {
                int64 responseCode = IHederaTokenService(token).associateToken(account, token);
                bytes memory result = abi.encode(responseCode);
                assembly {
                    return(add(result, 32), mload(result))
                }
            }
        }

        address target = emulator;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), target, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch ok
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
}
