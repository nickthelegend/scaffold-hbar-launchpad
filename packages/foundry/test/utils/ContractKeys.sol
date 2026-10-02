// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Vm } from "forge-std/Vm.sol";
import { Surl } from "hedera-forking/Surl.sol";

/// @notice Reads Hedera keys from the testnet mirror node and checks whether they contain a given contract.
/// @dev Contract keys (`Key{contractID}`) are how Hedera lets a contract act for an account or a token — e.g.
///      WHBAR's supply key is the WHBAR contract, SaucerSwap's fee account is keyed by the factory. The mirror node
///      serves such keys protobuf-encoded, which hedera-forking's JSON loader ignores, so fork tests check them here.
library ContractKeys {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    string internal constant TESTNET_API = "https://testnet.mirrornode.hedera.com/api/v1/";

    /// True if the key at `jsonPath` of mirror node resource `path` contains `Key{contractID: caller}`.
    function keyedBy(string memory path, string memory jsonPath, address caller) internal returns (bool) {
        if (uint160(caller) >> 64 != 0) return false; // only long-zero (entity-id) contract addresses
        (uint256 status, bytes memory body) = Surl.get(string.concat(TESTNET_API, path));
        if (status != 200 || !vm.keyExistsJson(string(body), jsonPath)) return false;
        string memory key = vm.parseJsonString(string(body), jsonPath);
        return vm.indexOf(key, contractKeyHex(uint64(uint160(caller)))) != type(uint256).max;
    }

    /// Hex of `Key{ contractID: ContractID{ contractNum: num } }`: 0a <len> 18 <varint num>.
    function contractKeyHex(uint64 num) internal pure returns (string memory) {
        bytes memory varint = _varint(num);
        bytes memory encoded = abi.encodePacked(bytes1(0x0a), uint8(varint.length + 1), bytes1(0x18), varint);
        return vm.replace(vm.toString(encoded), "0x", "");
    }

    function _varint(uint64 value) private pure returns (bytes memory out) {
        out = new bytes(10);
        uint256 length;
        do {
            uint8 b = uint8(value & 0x7f);
            value >>= 7;
            out[length++] = bytes1(value == 0 ? b : b | 0x80);
        } while (value != 0);
        assembly {
            mstore(out, length)
        }
    }
}
