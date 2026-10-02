// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { MirrorNode } from "hedera-forking/MirrorNode.sol";
import { MirrorNodeFFI } from "hedera-forking/MirrorNodeFFI.sol";
import { Surl } from "hedera-forking/Surl.sol";

/// @notice hedera-forking's mirror node provider, extended for contracts deployed inside a fork.
/// @dev The HTS emulator only lets an address associate with tokens if the mirror node knows the account. On Hedera
///      every contract is an account the moment it is created, but contracts deployed inside a forked test (the
///      Launchpad, new SaucerSwap pairs, test users) do not exist on the real network's mirror node yet. Real accounts
///      are still served from the mirror node; unknown ones are reported as existing, which is what the network does.
///      Every other lookup is delegated unchanged to hedera-forking's `MirrorNodeFFI`.
contract ForkMirrorNode is MirrorNode {
    string internal constant TESTNET_API = "https://testnet.mirrornode.hedera.com/api/v1/";
    MirrorNodeFFI internal immutable ffi = new MirrorNodeFFI();

    function fetchAccount(string memory account) external override returns (string memory) {
        (uint256 status, bytes memory body) =
            Surl.get(string.concat(TESTNET_API, "accounts/", account, "?transactions=false"));
        if (status == 404) return string.concat('{"evm_address":"', account, '"}');
        require(status == 200, string(body)); // surface rate limits and outages instead of inventing accounts
        return string(body);
    }

    function fetchTokenData(address token) external override returns (string memory) {
        return ffi.fetchTokenData(token);
    }

    function fetchBalance(address token, uint32 accountNum) external override returns (string memory) {
        return ffi.fetchBalance(token, accountNum);
    }

    function fetchAllowance(address token, uint32 ownerNum, uint32 spenderNum)
        external
        override
        returns (string memory)
    {
        return ffi.fetchAllowance(token, ownerNum, spenderNum);
    }

    function fetchNftAllowance(address token, uint32 ownerNum, uint32 operatorNum)
        external
        override
        returns (string memory)
    {
        return ffi.fetchNftAllowance(token, ownerNum, operatorNum);
    }

    function fetchTokenRelationshipOfAccount(string memory account, address token)
        external
        override
        returns (string memory)
    {
        return ffi.fetchTokenRelationshipOfAccount(account, token);
    }

    function fetchNonFungibleToken(address token, uint32 serial) external override returns (string memory) {
        return ffi.fetchNonFungibleToken(token, serial);
    }
}
