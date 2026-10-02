// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title BondingCurve
/// @notice Constant-product (x * y = k) pricing over virtual reserves, as popularised by pump.fun.
/// @dev Every launch sells `curveSupply` tokens and graduates once `threshold` HBAR has been raised.
///      The virtual reserves are chosen so that the curve's final spot price equals the opening price of
///      the SaucerSwap pool seeded with (`threshold` HBAR, `liquiditySupply` tokens) — there is no price
///      jump, and therefore no free arbitrage, at graduation. With `liquiditySupply = curveSupply / 4`
///      that condition solves to:
///
///          virtualHbar   = threshold / 3   + hbarRaised
///          virtualTokens = curveSupply / 3 + tokensLeftOnCurve
///
///      Units are always tinybars (HBAR inside the Hedera EVM has 8 decimals) and token base units.
library BondingCurve {
    /// Tokens received for `hbarIn` given the current virtual reserves. Rounds down (in favour of the curve).
    function tokensOut(uint256 vHbar, uint256 vTokens, uint256 hbarIn) internal pure returns (uint256) {
        return (vTokens * hbarIn) / (vHbar + hbarIn);
    }

    /// HBAR received for `tokenIn` given the current virtual reserves. Rounds down (in favour of the curve).
    function hbarOut(uint256 vHbar, uint256 vTokens, uint256 tokenIn) internal pure returns (uint256) {
        return (vHbar * tokenIn) / (vTokens + tokenIn);
    }

    function virtualHbar(uint256 threshold, uint256 hbarRaised) internal pure returns (uint256) {
        return threshold / 3 + hbarRaised;
    }

    function virtualTokens(uint256 curveSupply, uint256 tokensLeft) internal pure returns (uint256) {
        return curveSupply / 3 + tokensLeft;
    }
}
