// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { BondingCurve } from "../contracts/libraries/BondingCurve.sol";

/// @notice Property tests for the pricing maths, independent of HTS and SaucerSwap.
contract BondingCurveTest is Test {
    uint256 internal constant CURVE_SUPPLY = 800_000_000e8;
    uint256 internal constant LIQUIDITY_SUPPLY = 200_000_000e8;

    /// Raising exactly `threshold` sells (almost) the whole curve supply.
    function testFuzz_fullRaiseSellsCurveSupply(uint64 thresholdHbar) public pure {
        uint256 threshold = bound(thresholdHbar, 1, 1_000_000) * 1e8;
        uint256 out = BondingCurve.tokensOut(
            BondingCurve.virtualHbar(threshold, 0), BondingCurve.virtualTokens(CURVE_SUPPLY, CURVE_SUPPLY), threshold
        );
        // Flooring `threshold / 3` overshoots by a relative ~1e-9; the contract caps output at tokens left.
        assertApproxEqRel(out, CURVE_SUPPLY, 1e10);
    }

    /// The curve ends at the price the SaucerSwap pool opens at: threshold HBAR / liquidity supply.
    function testFuzz_finalPriceMatchesPoolPrice(uint64 thresholdHbar) public pure {
        uint256 threshold = bound(thresholdHbar, 1, 1_000_000) * 1e8;
        uint256 finalVirtualHbar = BondingCurve.virtualHbar(threshold, threshold);
        uint256 finalVirtualTokens = BondingCurve.virtualTokens(CURVE_SUPPLY, 0);

        uint256 curvePrice = finalVirtualHbar * 1e18 / finalVirtualTokens;
        uint256 poolPrice = threshold * 1e18 / LIQUIDITY_SUPPLY;
        assertApproxEqRel(curvePrice, poolPrice, 1e10);
    }

    /// Selling what you just bought never returns more HBAR than you paid (no free money from rounding).
    function testFuzz_buyThenSellNeverProfits(uint64 raisedSeed, uint64 hbarInSeed) public pure {
        uint256 threshold = 100e8;
        uint256 raised = bound(raisedSeed, 0, threshold - 1);
        uint256 hbarIn = bound(hbarInSeed, 1, threshold - raised);
        // Tokens left are whatever the curve would hold after `raised` was spent from a fresh start.
        uint256 sold = BondingCurve.tokensOut(
            BondingCurve.virtualHbar(threshold, 0), BondingCurve.virtualTokens(CURVE_SUPPLY, CURVE_SUPPLY), raised
        );
        uint256 tokensLeft = CURVE_SUPPLY - sold;

        uint256 vHbar = BondingCurve.virtualHbar(threshold, raised);
        uint256 vTokens = BondingCurve.virtualTokens(CURVE_SUPPLY, tokensLeft);
        uint256 bought = BondingCurve.tokensOut(vHbar, vTokens, hbarIn);
        uint256 back = BondingCurve.hbarOut(vHbar + hbarIn, vTokens - bought, bought);

        assertLe(back, hbarIn);
    }

    /// Larger purchases always get a worse average price.
    function testFuzz_priceImpactIsMonotonic(uint64 smallSeed, uint64 extraSeed) public pure {
        uint256 threshold = 100e8;
        uint256 vHbar = BondingCurve.virtualHbar(threshold, 0);
        uint256 vTokens = BondingCurve.virtualTokens(CURVE_SUPPLY, CURVE_SUPPLY);
        uint256 small = bound(smallSeed, 1e6, 50e8);
        uint256 large = small + bound(extraSeed, 1e6, 50e8);

        uint256 smallOut = BondingCurve.tokensOut(vHbar, vTokens, small);
        uint256 largeOut = BondingCurve.tokensOut(vHbar, vTokens, large);
        assertGt(largeOut, smallOut);
        assertLe(largeOut * 1e18 / large, smallOut * 1e18 / small);
    }
}
