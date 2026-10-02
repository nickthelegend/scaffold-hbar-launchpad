// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { HederaResponseCodes } from "hedera-forking/HederaResponseCodes.sol";
import { HtsSystemContract } from "hedera-forking/HtsSystemContract.sol";
import { HtsSystemContractJson } from "hedera-forking/HtsSystemContractJson.sol";
import { IHederaTokenService } from "hedera-forking/IHederaTokenService.sol";
import { KeyLib } from "hedera-forking/KeyLib.sol";

import { ContractKeys } from "./ContractKeys.sol";

/// @notice hedera-forking's HTS emulator plus the HTS v1 ABI still used by contracts compiled before HIP-206's
///         `int64` revision — notably SaucerSwap V1, deployed in 2022.
/// @dev The network keeps serving both ABIs; the pinned emulator only implements v2. Each v1 entry point converts its
///      arguments and re-dispatches to the v2 implementation with `delegatecall`, so `msg.sender` (and therefore
///      treasury and supply-key checks) is preserved. v1 and v2 return values encode identically for valid values.
contract HtsV1Compat is HtsSystemContractJson {
    uint256 internal constant SUPPLY_KEY = 0x10;

    struct ExpiryV1 {
        uint32 second;
        address autoRenewAccount;
        uint32 autoRenewPeriod;
    }

    struct HederaTokenV1 {
        string name;
        string symbol;
        address treasury;
        string memo;
        bool tokenSupplyType;
        uint32 maxSupply;
        bool freezeDefault;
        IHederaTokenService.TokenKey[] tokenKeys;
        ExpiryV1 expiry;
    }

    /// v1 selector 0x7812a04b, used by SaucerSwap pairs to create their LP token.
    function createFungibleToken(HederaTokenV1 memory token, uint256 initialTotalSupply, uint256 decimals_)
        external
        payable
        returns (int64, address)
    {
        IHederaTokenService.HederaToken memory v2 = IHederaTokenService.HederaToken({
            name: token.name,
            symbol: token.symbol,
            treasury: token.treasury,
            memo: token.memo,
            tokenSupplyType: token.tokenSupplyType,
            maxSupply: int64(uint64(token.maxSupply)),
            freezeDefault: token.freezeDefault,
            tokenKeys: token.tokenKeys,
            expiry: IHederaTokenService.Expiry({
                second: int64(uint64(token.expiry.second)),
                autoRenewAccount: token.expiry.autoRenewAccount,
                autoRenewPeriod: int64(uint64(token.expiry.autoRenewPeriod))
            })
        });
        _redispatch(
            abi.encodeCall(
                IHederaTokenService.createFungibleToken,
                (v2, int64(uint64(initialTotalSupply)), int32(uint32(decimals_)))
            )
        );
    }

    /// v1 `mintToken(address,uint64,bytes[])`, used by SaucerSwap pairs (LP tokens) and the WHBAR contract.
    /// @dev Contract supply keys arrive protobuf-encoded from the mirror node and are dropped by the emulator's JSON
    ///      loader, so a remote token keyed by a contract looks keyless. In that case the key is checked against the
    ///      mirror node and the mint applied to the treasury, as the network does.
    function mintToken(address token, uint64 amount, bytes[] memory metadata)
        external
        returns (int256, uint64, int256[] memory)
    {
        (, TokenInfo memory info) = IHederaTokenService(token).getTokenInfo(token);
        if (KeyLib.keyExists(SUPPLY_KEY, info)) {
            _redispatch(abi.encodeCall(IHederaTokenService.mintToken, (token, int64(amount), metadata)));
        }
        string memory tokenPath = string.concat("tokens/0.0.", ContractKeys.vm.toString(uint160(token)));
        if (amount == 0 || !ContractKeys.keyedBy(tokenPath, ".supply_key.key", msg.sender)) {
            return (HederaResponseCodes.TOKEN_HAS_NO_SUPPLY_KEY, uint64(info.totalSupply), new int256[](0));
        }
        HtsSystemContract(token)._update(address(0), info.token.treasury, amount);
        return (HederaResponseCodes.SUCCESS, uint64(info.totalSupply) + amount, new int256[](0));
    }

    /// v1 `burnToken(address,uint64,int64[])`, used by SaucerSwap pairs when liquidity is removed.
    function burnToken(address token, uint64 amount, int64[] memory serialNumbers) external returns (int256, uint64) {
        _redispatch(abi.encodeCall(IHederaTokenService.burnToken, (token, int64(amount), serialNumbers)));
    }

    function _redispatch(bytes memory callData) private {
        (bool ok, bytes memory result) = address(this).delegatecall(callData);
        assembly {
            switch ok
            case 0 { revert(add(result, 32), mload(result)) }
            default { return(add(result, 32), mload(result)) }
        }
    }
}
