// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { HtsSystemContractJson } from "hedera-forking/HtsSystemContractJson.sol";

import { ForkMirrorNode } from "./ForkMirrorNode.sol";
import { HtsContractKeyRouter } from "./HtsContractKeyRouter.sol";
import { HtsV1Compat } from "./HtsV1Compat.sol";
import { LiveExchangeRate } from "./LiveExchangeRate.sol";

/// @notice Forks Hedera testnet with Hedera's native services wired in:
///  - HTS (0x167): hedera-forking's emulator (plus the v1 ABI SaucerSwap uses), reading real token and account state
///    from the mirror node;
///  - Exchange rate (0x168): the live network rate from the mirror node.
/// Everything else — SaucerSwap's factory, router, pairs and WHBAR — is the real deployed bytecode and state.
abstract contract ForkTestBase is Test {
    /// Pinned so runs are reproducible and Foundry can cache RPC responses. Bump to pick up newer testnet state.
    uint256 internal constant FORK_BLOCK = 41_276_255;
    address internal constant HTS = address(0x167);
    address internal constant EXCHANGE_RATE = address(0x168);

    /// HIP-719 token proxy bytecode, with `fefe…fe` standing in for the token address (same template hedera-forking uses).
    string internal constant HIP719_PROXY_TEMPLATE =
        "6080604052348015600f57600080fd5b506000610167905077618dc65efefefefefefefefefefefefefefefefefefefefe600052366000602037600080366018016008845af43d806000803e8160008114605857816000f35b816000fdfea2646970667358221220d8378feed472ba49a0005514ef7087017f707b45fb9bf56bb81bb93ff19a238b64736f6c634300080b0033";

    /// @dev Hashio now reports HTS token code as an EIP-7702 delegation to 0x167 (`0xef0100…0167`). Executed in a fork
    ///      that runs the emulator *as* the token, which it rejects. The HIP-719 proxy instead forwards calls to the
    ///      emulator, which then loads the token's real state from the mirror node.
    function _useRealHtsToken(address token) internal {
        string memory hexAddress = vm.replace(vm.toLowercase(vm.toString(token)), "0x", "");
        vm.etch(
            token,
            vm.parseBytes(vm.replace(HIP719_PROXY_TEMPLATE, "fefefefefefefefefefefefefefefefefefefefe", hexAddress))
        );
    }

    function _forkHederaTestnet() internal {
        vm.createSelectFork(vm.rpcUrl("hedera_testnet"), FORK_BLOCK);
        _installHts();

        vm.etch(EXCHANGE_RATE, address(new LiveExchangeRate()).code);
        string[] memory curl = new string[](3);
        curl[0] = "curl";
        curl[1] = "-s";
        // The rate in force at the fork block, so runs are reproducible.
        curl[2] = string.concat(
            "https://testnet.mirrornode.hedera.com/api/v1/network/exchangerate?timestamp=", vm.toString(block.timestamp)
        );
        string memory json = string(vm.ffi(curl));
        LiveExchangeRate(EXCHANGE_RATE)
            .setRate(
                vm.parseJsonUint(json, ".current_rate.cent_equivalent"),
                vm.parseJsonUint(json, ".current_rate.hbar_equivalent")
            );
    }

    /// Same steps as hedera-forking's `htsSetup`, with the v1-compatible emulator behind a contract-key-aware front,
    /// and the fork-aware mirror node.
    function _installHts() private {
        address emulator = address(new HtsV1Compat());
        vm.etch(HTS, address(new HtsContractKeyRouter(emulator)).code);
        HtsSystemContractJson(HTS).setMirrorNodeProvider(new ForkMirrorNode());
        vm.allowCheatcodes(HTS);
    }
}
