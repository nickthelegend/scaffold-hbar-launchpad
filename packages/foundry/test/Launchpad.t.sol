// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { Launchpad } from "../contracts/Launchpad.sol";
import { IExchangeRate } from "../contracts/interfaces/IExchangeRate.sol";
import {
    ISaucerSwapV1Factory,
    ISaucerSwapV1Pair,
    ISaucerSwapV1Router,
    IWHBAR
} from "../contracts/interfaces/ISaucerSwapV1.sol";
import { ForkTestBase } from "./utils/ForkTestBase.sol";

interface IHtsFreezeView {
    function isFrozen(address token, address account) external view returns (int64 responseCode, bool frozen);
}

/// @notice Integration tests against the real SaucerSwap V1 deployment on a Hedera testnet fork.
///         No protocol mocks: pools are created by SaucerSwap's factory, liquidity goes through its router, LP tokens
///         are real HTS tokens minted by real pairs. Requires network access (Hashio RPC + mirror node).
contract LaunchpadTest is ForkTestBase {
    uint256 internal constant HBAR = 1e8; // tinybars
    uint256 internal constant THRESHOLD = 100 * HBAR;
    uint256 internal constant WHOLE_TOKEN = 1e8;

    /// SaucerSwap V1 RouterV3 on testnet (0.0.19264) — https://docs.saucerswap.finance/developerx/contract-deployments
    ISaucerSwapV1Router internal constant ROUTER = ISaucerSwapV1Router(0x0000000000000000000000000000000000004b40);

    Launchpad internal launchpad;
    ISaucerSwapV1Factory internal factory;
    address internal whbar;

    address internal creator = makeAddr("creator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal treasury = makeAddr("treasury");

    function setUp() public {
        _forkHederaTestnet();

        launchpad = new Launchpad(ROUTER, treasury, THRESHOLD);
        factory = ISaucerSwapV1Factory(ROUTER.factory());
        whbar = ROUTER.whbar();
        _useRealHtsToken(whbar);

        vm.deal(creator, 1_000 * HBAR);
        vm.deal(alice, 1_000 * HBAR);
        vm.deal(bob, 1_000 * HBAR);
    }

    // ------------------------------------------------------------------ helpers

    function _launch() internal returns (address token) {
        uint256 cost = launchpad.quoteLaunchCost();
        vm.prank(creator);
        token = launchpad.createLaunch{ value: cost }("Hashgraph Cat", "HCAT", "ipfs://cat", "meow");
    }

    function _buy(address who, address token, uint256 value) internal returns (uint256 tokensOut) {
        vm.prank(who);
        tokensOut = launchpad.buy{ value: value }(token, 0);
    }

    function _sell(address who, address token, uint256 amount) internal returns (uint256 hbarOut) {
        vm.startPrank(who);
        IERC20(token).approve(address(launchpad), amount);
        hbarOut = launchpad.sell(token, amount, 0);
        vm.stopPrank();
    }

    function _reserves(address pair, address token) internal view returns (uint256 reserveToken, uint256 reserveHbar) {
        (uint112 reserve0, uint112 reserve1,) = ISaucerSwapV1Pair(pair).getReserves();
        (reserveToken, reserveHbar) =
            ISaucerSwapV1Pair(pair).token0() == token ? (reserve0, reserve1) : (reserve1, reserve0);
    }

    // ------------------------------------------------------------------ deployment

    function test_constructor_readsSaucerSwapAddressesFromRouter() public view {
        assertEq(address(launchpad.factory()), 0x00000000000000000000000000000000000026E7); // 0.0.9959
        assertEq(launchpad.whbar(), 0x0000000000000000000000000000000000003aD2); // 0.0.15058
        assertEq(launchpad.feeRecipient(), treasury);
        assertEq(launchpad.graduationThreshold(), THRESHOLD);
    }

    function test_constructor_revertsOnInvalidConfig() public {
        vm.expectRevert(Launchpad.InvalidConfig.selector);
        new Launchpad(ROUTER, address(0), THRESHOLD);

        vm.expectRevert(Launchpad.InvalidConfig.selector);
        new Launchpad(ROUTER, treasury, 2);
    }

    // ------------------------------------------------------------------ launching

    function test_quoteLaunchCost_convertsUsdFeesWithLiveExchangeRate() public view {
        IExchangeRate rates = IExchangeRate(EXCHANGE_RATE);
        uint256 expected = rates.tinycentsToTinybars(launchpad.TOKEN_CREATE_BUDGET_TINYCENTS())
            + rates.tinycentsToTinybars(factory.pairCreateFee());
        assertEq(launchpad.quoteLaunchCost(), expected);
    }

    function test_createLaunch_mintsFixedSupplyAndCreatesSaucerSwapPair() public {
        address token = _launch();

        assertEq(IERC20(token).totalSupply(), launchpad.TOTAL_SUPPLY());
        assertEq(IERC20(token).balanceOf(address(launchpad)), launchpad.TOTAL_SUPPLY());

        Launchpad.Launch memory launch = launchpad.getLaunch(token);
        assertEq(launch.creator, creator);
        assertEq(launch.pair, factory.getPair(token, whbar), "pair registered in SaucerSwap's factory");
        assertEq(launch.lpToken, ISaucerSwapV1Pair(launch.pair).lpToken());
        assertEq(launch.tokensLeft, launchpad.CURVE_SUPPLY());
        assertEq(launch.hbarRaised, 0);
        assertFalse(launch.graduated);
        assertEq(launchpad.launchCount(), 1);
    }

    function test_createLaunch_refundsOverpayment() public {
        uint256 cost = launchpad.quoteLaunchCost();
        vm.prank(creator);
        launchpad.createLaunch{ value: cost + 7 * HBAR }("Refund", "RFND", "", "");
        // The emulator keeps the whole HTS budget; on the network the part HTS does not charge is refunded as well.
        assertEq(creator.balance, 1_000 * HBAR - cost);
    }

    function test_createLaunch_emitsMetadata() public {
        uint256 cost = launchpad.quoteLaunchCost();
        vm.expectEmit(false, true, false, false);
        emit Launchpad.LaunchCreated(address(0), creator, address(0), "Hashgraph Cat", "HCAT", "ipfs://cat", "meow");
        vm.prank(creator);
        launchpad.createLaunch{ value: cost }("Hashgraph Cat", "HCAT", "ipfs://cat", "meow");
    }

    function test_createLaunch_revertsWhenUnderpaid() public {
        uint256 cost = launchpad.quoteLaunchCost();
        vm.expectRevert(abi.encodeWithSelector(Launchpad.InsufficientLaunchFee.selector, cost, cost - 1));
        vm.prank(creator);
        launchpad.createLaunch{ value: cost - 1 }("Cheap", "CHEAP", "", "");
    }

    function test_createLaunch_revertsOnInvalidMetadata() public {
        uint256 cost = launchpad.quoteLaunchCost();
        vm.startPrank(creator);
        vm.expectRevert(Launchpad.InvalidMetadata.selector);
        launchpad.createLaunch{ value: cost }("", "SYM", "", "");
        vm.expectRevert(Launchpad.InvalidMetadata.selector);
        launchpad.createLaunch{ value: cost }("Name", "WAYTOOLONGSYMBOL1", "", "");
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ trading

    function test_buy_transfersTokensAndChargesFee() public {
        address token = _launch();
        (uint256 quoted, uint256 quotedFee,) = launchpad.quoteBuy(token, 10 * HBAR);

        uint256 tokensOut = _buy(alice, token, 10 * HBAR);

        assertEq(tokensOut, quoted);
        assertEq(IERC20(token).balanceOf(alice), tokensOut);
        assertEq(quotedFee, 10 * HBAR / 100);
        assertEq(launchpad.accruedFees(), quotedFee);
        Launchpad.Launch memory launch = launchpad.getLaunch(token);
        assertEq(launch.hbarRaised, 10 * HBAR - quotedFee);
        assertEq(launch.tokensLeft, launchpad.CURVE_SUPPLY() - tokensOut);
    }

    function test_spotPrice_revertsAfterGraduation() public {
        address token = _launch();
        _buy(alice, token, 200 * HBAR);
        vm.expectRevert(abi.encodeWithSelector(Launchpad.AlreadyGraduated.selector, token));
        launchpad.spotPrice(token);
    }

    function test_spotPrice_isScaledSoEarlyPricesAreNonZero() public {
        address token = _launch();
        // (threshold / 3) / (curveSupply * 4 / 3) at 100 HBAR is ~3.1 tinybars per token; at small thresholds it is < 1.
        // forge-lint: disable-next-line(divide-before-multiply) — mirrors the contract's floored virtual reserve
        uint256 expected = (THRESHOLD / 3) * WHOLE_TOKEN * launchpad.PRICE_SCALE() / (launchpad.CURVE_SUPPLY() * 4 / 3);
        assertApproxEqRel(launchpad.spotPrice(token), expected, 1e12);
    }

    function test_buy_priceRisesWithDemand() public {
        address token = _launch();
        uint256 firstPrice = launchpad.spotPrice(token);
        uint256 first = _buy(alice, token, 10 * HBAR);
        uint256 second = _buy(bob, token, 10 * HBAR);
        assertLt(second, first);
        assertGt(launchpad.spotPrice(token), firstPrice);
    }

    function test_buy_revertsOnSlippage() public {
        address token = _launch();
        (uint256 quoted,,) = launchpad.quoteBuy(token, 10 * HBAR);
        vm.expectRevert(abi.encodeWithSelector(Launchpad.SlippageExceeded.selector, quoted, quoted + 1));
        vm.prank(alice);
        launchpad.buy{ value: 10 * HBAR }(token, quoted + 1);
    }

    function test_buy_revertsForUnknownToken() public {
        vm.expectRevert(abi.encodeWithSelector(Launchpad.UnknownLaunch.selector, address(0xdead)));
        vm.prank(alice);
        launchpad.buy{ value: HBAR }(address(0xdead), 0);
    }

    function test_sell_paysHbarMinusFee() public {
        address token = _launch();
        uint256 bought = _buy(alice, token, 20 * HBAR);
        (uint256 quoted, uint256 fee) = launchpad.quoteSell(token, bought / 2);
        uint256 balanceBefore = alice.balance;

        uint256 hbarOut = _sell(alice, token, bought / 2);

        assertEq(hbarOut, quoted);
        assertEq(alice.balance - balanceBefore, hbarOut);
        assertEq(IERC20(token).balanceOf(alice), bought - bought / 2);
        assertGt(fee, 0);
    }

    function test_sell_requiresAllowance() public {
        address token = _launch();
        uint256 bought = _buy(alice, token, 5 * HBAR);
        vm.prank(alice);
        vm.expectRevert();
        launchpad.sell(token, bought, 0);
    }

    function test_roundTrip_losesOnlyFees() public {
        address token = _launch();
        uint256 bought = _buy(alice, token, 50 * HBAR);
        uint256 hbarBack = _sell(alice, token, bought);

        // 1% on the way in, 1% on the way out, plus integer rounding.
        assertApproxEqRel(hbarBack, 50 * HBAR * 99 / 100 * 99 / 100, 1e12);
        assertEq(launchpad.getLaunch(token).tokensLeft, launchpad.CURVE_SUPPLY());
    }

    // ------------------------------------------------------------------ graduation into real SaucerSwap

    function test_buy_overshootIsRefundedAndGraduates() public {
        address token = _launch();
        (, uint256 fee, uint256 refund) = launchpad.quoteBuy(token, 150 * HBAR);
        uint256 balanceBefore = alice.balance;

        _buy(alice, token, 150 * HBAR);

        assertEq(balanceBefore - alice.balance, 150 * HBAR - refund);
        assertEq(150 * HBAR - refund - fee, THRESHOLD, "only the remaining amount is spent");
        assertTrue(launchpad.getLaunch(token).graduated);
    }

    function test_graduation_seedsSaucerSwapAndLocksLiquidity() public {
        address token = _launch();
        _buy(alice, token, 60 * HBAR);
        _buy(bob, token, 60 * HBAR);

        Launchpad.Launch memory launch = launchpad.getLaunch(token);
        assertTrue(launch.graduated);
        assertEq(launch.hbarRaised, 0);
        assertEq(launch.tokensLeft, 0);

        (uint256 reserveToken, uint256 reserveHbar) = _reserves(launch.pair, token);
        assertEq(reserveHbar, THRESHOLD, "raised HBAR wrapped into the pool as WHBAR");
        // Reserved supply plus any rounding dust from the curve.
        assertApproxEqAbs(reserveToken, launchpad.LIQUIDITY_SUPPLY(), 1_000 * WHOLE_TOKEN);
        assertEq(IERC20(token).balanceOf(address(launchpad)), 0, "no supply left behind");
        assertGt(IERC20(launch.lpToken).balanceOf(address(launchpad)), 0, "LP held (locked) by the launchpad");
    }

    function test_graduation_poolOpensAtFinalCurvePrice() public {
        address token = _launch();
        _buy(alice, token, 99 * HBAR); // just below the threshold after fees
        uint256 curvePrice = launchpad.spotPrice(token);
        _buy(bob, token, 10 * HBAR);

        (uint256 reserveToken, uint256 reserveHbar) = _reserves(launchpad.getLaunch(token).pair, token);
        uint256 scale = launchpad.PRICE_SCALE();
        uint256 poolPrice = reserveHbar * WHOLE_TOKEN * scale / reserveToken;
        // The last buy moves the curve a little further; the pool price must sit at the curve's end, not jump.
        assertGe(poolPrice, curvePrice);
        assertApproxEqRel(poolPrice, THRESHOLD * WHOLE_TOKEN * scale / launchpad.LIQUIDITY_SUPPLY(), 1e15);
    }

    function test_graduatedToken_tradesOnSaucerSwap() public {
        address token = _launch();
        _buy(alice, token, 200 * HBAR);

        address[] memory path = new address[](2);
        path[0] = whbar;
        path[1] = token;
        uint256 quoted = ROUTER.getAmountsOut(5 * HBAR, path)[1];

        vm.prank(bob);
        ROUTER.swapExactETHForTokens{ value: 5 * HBAR }(quoted, path, bob, block.timestamp + 60);

        assertEq(IERC20(token).balanceOf(bob), quoted);
    }

    function test_trading_revertsAfterGraduation() public {
        address token = _launch();
        uint256 bought = _buy(alice, token, 200 * HBAR);

        vm.expectRevert(abi.encodeWithSelector(Launchpad.AlreadyGraduated.selector, token));
        vm.prank(bob);
        launchpad.buy{ value: HBAR }(token, 0);

        vm.startPrank(alice);
        IERC20(token).approve(address(launchpad), bought);
        vm.expectRevert(abi.encodeWithSelector(Launchpad.AlreadyGraduated.selector, token));
        launchpad.sell(token, bought, 0);
        vm.stopPrank();
    }

    function test_createLaunch_freezesPoolUntilGraduation() public {
        address token = _launch();
        address pair = launchpad.getLaunch(token).pair;
        (, bool frozen) = IHtsFreezeView(HTS).isFrozen(token, pair);
        assertTrue(frozen, "pool frozen at launch");

        _buy(alice, token, 200 * HBAR);
        (, frozen) = IHtsFreezeView(HTS).isFrozen(token, pair);
        assertFalse(frozen, "pool unfrozen at graduation");
    }

    function test_frozenPool_cannotBeSeededBeforeGraduation() public {
        address token = _launch();
        uint256 bought = _buy(alice, token, 10 * HBAR);
        address pair = launchpad.getLaunch(token).pair;

        // Through SaucerSwap's router: the router's HTS transfer into the frozen pair fails.
        vm.startPrank(alice);
        IERC20(token).approve(address(ROUTER), bought);
        vm.expectRevert();
        ROUTER.addLiquidityETH{ value: HBAR }(token, bought, 0, 0, alice, block.timestamp + 60);

        // Directly through the token's ERC-20 facade.
        vm.expectRevert();
        IERC20(token).transfer(pair, bought);
        vm.stopPrank();
    }

    function test_graduation_ignoresWhbarDonatedToPool() public {
        address token = _launch();
        address pair = launchpad.getLaunch(token).pair;

        // Anyone can still send WHBAR to the pair (only the launch token is frozen). It must not block graduation.
        vm.prank(alice);
        IWHBAR(ROUTER.WHBAR()).deposit{ value: 5 * HBAR }(alice, pair);

        _buy(bob, token, 200 * HBAR);

        Launchpad.Launch memory launch = launchpad.getLaunch(token);
        assertTrue(launch.graduated);
        (uint256 reserveToken, uint256 reserveHbar) = _reserves(pair, token);
        assertEq(reserveHbar, THRESHOLD + 5 * HBAR, "donation stays in the pool, owned by the locked LP");
        assertApproxEqAbs(reserveToken, launchpad.LIQUIDITY_SUPPLY(), 1_000 * WHOLE_TOKEN);
        assertGt(IERC20(launch.lpToken).balanceOf(address(launchpad)), 0);
    }

    /// Regression: flooring `threshold / 3` once made the closing buy compute more tokens than remained.
    /// forge-config: default.fuzz.runs = 16
    function testFuzz_closingBuyNeverExceedsSupply(uint96 first, uint96 sellPart) public {
        address token = _launch();
        uint256 firstBuy = bound(first, HBAR, 99 * HBAR);
        uint256 bought = _buy(alice, token, firstBuy);
        uint256 toSell = bound(sellPart, 0, bought);
        if (toSell > 0) {
            (uint256 hbarOut,) = launchpad.quoteSell(token, toSell);
            if (hbarOut > 0) _sell(alice, token, toSell);
        }

        _buy(bob, token, 500 * HBAR);

        assertTrue(launchpad.getLaunch(token).graduated);
        assertEq(IERC20(token).balanceOf(address(launchpad)), 0);
    }

    // ------------------------------------------------------------------ fees & views

    function test_withdrawFees_sendsToRecipient() public {
        address token = _launch();
        _buy(alice, token, 10 * HBAR);
        uint256 fees = launchpad.accruedFees();

        launchpad.withdrawFees();

        assertEq(treasury.balance, fees);
        assertEq(launchpad.accruedFees(), 0);
    }

    function test_getLaunches_paginatesNewestFirst() public {
        address first = _launch();
        address second = _launch();
        address third = _launch();

        (address[] memory page,) = launchpad.getLaunches(0, 2);
        assertEq(page.length, 2);
        assertEq(page[0], third);
        assertEq(page[1], second);

        (page,) = launchpad.getLaunches(2, 10);
        assertEq(page.length, 1);
        assertEq(page[0], first);

        (page,) = launchpad.getLaunches(5, 10);
        assertEq(page.length, 0);
    }

    function test_receive_rejectsUnexpectedSenders() public {
        vm.prank(alice);
        (bool ok,) = address(launchpad).call{ value: HBAR }("");
        assertFalse(ok);
    }
}
