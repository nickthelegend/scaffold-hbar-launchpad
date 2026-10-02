// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Vm } from "forge-std/Vm.sol";
import { IHederaTokenService } from "hedera-forking/IHederaTokenService.sol";
import { ContractKeys } from "./ContractKeys.sol";
import { HtsFreeze } from "./HtsFreeze.sol";

/// @notice Front for the HTS emulator at 0x167 that honours contract keys on associations and enforces freezes.
/// @dev On Hedera a contract may associate *another* account if that account's key contains the contract's ID
///      (`ContractID` key). SaucerSwap's factory relies on this to associate its `feeTo` account (whose threshold key
///      includes the factory) with every new LP token. hedera-forking only accepts `account == msg.sender`, so this
///      front checks the account's real key on the mirror node and, when it is keyed by the caller, records the
///      association through the token exactly as the emulator would.
///      It also rejects transfers from or to a frozen account (ACCOUNT_FROZEN_FOR_TOKEN), on both paths a transfer can
///      take: the system contract (`transferToken`, `transferFrom`) and the token's ERC-20 facade, which reaches this
///      code through the token's HIP-719 proxy. Every other call is delegated to the emulator, keeping storage and
///      `address(this)` intact.
contract HtsContractKeyRouter {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address internal immutable emulator;

    constructor(address emulator_) {
        emulator = emulator_;
    }

    bytes4 internal constant REDIRECT_FOR_TOKEN = 0x618dc65e;

    fallback() external payable {
        _rejectFrozenTransfers();
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

    function _rejectFrozenTransfers() internal view {
        if (address(this) == address(0x167)) {
            address token;
            address from;
            address to;
            if (msg.sig == IHederaTokenService.transferToken.selector) {
                (token, from, to) = abi.decode(msg.data[4:], (address, address, address));
            } else if (msg.sig == IHederaTokenService.transferFrom.selector) {
                (token, from, to) = abi.decode(msg.data[4:], (address, address, address));
            } else {
                return;
            }
            if (_frozenAt(token, from) || _frozenAt(token, to)) _returnFrozen();
            return;
        }

        // Token context: calldata is redirectForToken(token, innerCall), packed as selector ‖ token ‖ innerCall.
        if (msg.sig != REDIRECT_FOR_TOKEN || msg.data.length < 28) return;
        bytes4 inner = bytes4(msg.data[24:28]);
        address sender;
        address recipient;
        if (inner == IERC20Minimal.transfer.selector) {
            (recipient) = abi.decode(msg.data[28:], (address));
            sender = msg.sender;
        } else if (inner == IERC20Minimal.transferFrom.selector) {
            (sender, recipient) = abi.decode(msg.data[28:], (address, address));
        } else {
            return;
        }
        if (_frozenHere(sender) || _frozenHere(recipient)) revert("ACCOUNT_FROZEN_FOR_TOKEN");
    }

    function _frozenAt(address token, address account) internal view returns (bool) {
        return uint256(vm.load(token, HtsFreeze.slot(account))) == 1;
    }

    function _frozenHere(address account) internal view returns (bool frozen) {
        bytes32 key = HtsFreeze.slot(account);
        assembly {
            frozen := eq(sload(key), 1)
        }
    }

    function _returnFrozen() internal pure {
        bytes memory result = abi.encode(HtsFreeze.ACCOUNT_FROZEN_FOR_TOKEN);
        assembly {
            return(add(result, 32), mload(result))
        }
    }
}

interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);

    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}
