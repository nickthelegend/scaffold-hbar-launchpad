// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IHederaTokenService } from "hedera-forking/IHederaTokenService.sol";
import { HederaResponseCodes } from "hedera-forking/HederaResponseCodes.sol";

import { IExchangeRate } from "./interfaces/IExchangeRate.sol";
import { ISaucerSwapV1Factory, ISaucerSwapV1Pair, ISaucerSwapV1Router } from "./interfaces/ISaucerSwapV1.sol";
import { BondingCurve } from "./libraries/BondingCurve.sol";

/// @title Launchpad
/// @notice Fair-launch HTS tokens on a bonding curve, then graduate them into a SaucerSwap V1 pool.
///
/// Lifecycle of a launch:
///  1. `createLaunch` mints a fixed-supply HTS token with no admin, supply, freeze, wipe or pause keys
///     (nobody — including this contract — can ever mint more or confiscate balances). This contract is
///     the treasury. The SaucerSwap token/WHBAR pair is created in the same transaction so its HTS LP
///     token can be associated up front.
///  2. `buy` / `sell` trade against a constant-product curve priced in HBAR. 80% of supply is sold here.
///  3. When `graduationThreshold` HBAR has been raised, the raised HBAR plus the remaining 20% of supply
///     are deposited into the SaucerSwap pool. The LP tokens are held by this contract, which has no
///     function to move them: liquidity is locked forever. Trading continues on SaucerSwap.
///
/// @dev Hedera specifics worth knowing when reading this contract:
///  - Inside the EVM, HBAR amounts (`msg.value`, balances) are in tinybars (8 decimals), not weibars.
///  - HTS tokens expose an ERC-20 facade at their address (HIP-218/HIP-376), so `IERC20` calls work.
///  - Accounts must be associated with an HTS token before receiving it unless they have free
///    auto-association slots. Wallet-created (EVM alias) accounts default to unlimited slots.
///  - SaucerSwap charges its pool-creation fee in USD; we convert it with the exchange rate system contract.
contract Launchpad is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Launch {
        address creator;
        address pair; // SaucerSwap V1 token/WHBAR pair
        address lpToken; // HTS LP token of `pair`, held (locked) by this contract after graduation
        uint64 createdAt;
        bool graduated;
        uint256 hbarRaised; // real tinybars held for this curve
        uint256 tokensLeft; // tokens still for sale on the curve
    }

    address internal constant HTS = address(0x167);
    address internal constant EXCHANGE_RATE = address(0x168);

    uint8 public constant DECIMALS = 8;
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 10 ** DECIMALS;
    uint256 public constant CURVE_SUPPLY = (TOTAL_SUPPLY * 4) / 5;
    uint256 public constant LIQUIDITY_SUPPLY = TOTAL_SUPPLY - CURVE_SUPPLY;

    uint256 public constant FEE_BPS = 100; // 1% on every curve trade
    /// Fixed-point scale of `spotPrice` (18 decimals).
    uint256 public constant PRICE_SCALE = 1e18;
    uint256 internal constant BPS = 10_000;

    /// Budget forwarded to the HTS system contract for token creation, in tinycents ($1.30).
    /// A contract-initiated fungible token create costs ~$1.13 on testnet; HTS only charges the actual fee and the
    /// unused part is refunded to the creator, so this only needs to cover the fee plus some headroom.
    uint256 public constant TOKEN_CREATE_BUDGET_TINYCENTS = 1.3e10;
    /// HTS auto-renew period for launched tokens (90 days, the network minimum).
    int64 internal constant AUTO_RENEW_PERIOD = 7_776_000;

    ISaucerSwapV1Router public immutable router;
    ISaucerSwapV1Factory public immutable factory;
    /// HTS token address of WHBAR, the asset SaucerSwap pairs against.
    address public immutable whbar;
    address public immutable feeRecipient;
    /// Real HBAR (tinybars) a curve must raise to graduate.
    uint256 public immutable graduationThreshold;

    uint256 public accruedFees;
    address[] internal _tokens;
    mapping(address token => Launch) internal _launches;

    event LaunchCreated(
        address indexed token,
        address indexed creator,
        address pair,
        string name,
        string symbol,
        string imageUri,
        string description
    );
    event Trade(
        address indexed token,
        address indexed trader,
        bool isBuy,
        uint256 hbarAmount,
        uint256 tokenAmount,
        uint256 fee,
        uint256 hbarRaised,
        uint256 tokensLeft
    );
    event Graduated(
        address indexed token, address indexed pair, uint256 hbarLiquidity, uint256 tokenLiquidity, uint256 lpTokens
    );
    event FeesWithdrawn(address indexed to, uint256 amount);

    error InvalidConfig();
    error InvalidMetadata();
    error InsufficientLaunchFee(uint256 required, uint256 provided);
    error HtsCallFailed(int64 responseCode);
    error UnknownLaunch(address token);
    error AlreadyGraduated(address token);
    error ZeroAmount();
    error SlippageExceeded(uint256 amountOut, uint256 minAmountOut);
    error HbarTransferFailed(address to, uint256 amount);
    error UnexpectedHbarSender(address sender);

    constructor(ISaucerSwapV1Router router_, address feeRecipient_, uint256 graduationThreshold_) {
        // Below 3 tinybars the virtual HBAR reserve (threshold / 3) would be zero.
        if (address(router_) == address(0) || feeRecipient_ == address(0) || graduationThreshold_ < 3) {
            revert InvalidConfig();
        }
        router = router_;
        factory = ISaucerSwapV1Factory(router_.factory());
        whbar = router_.whbar();
        feeRecipient = feeRecipient_;
        graduationThreshold = graduationThreshold_;
    }

    /// @dev Only SaucerSwap refunds HBAR to this contract (unused liquidity amounts).
    receive() external payable {
        if (msg.sender != address(router)) revert UnexpectedHbarSender(msg.sender);
    }

    // ---------------------------------------------------------------------------------------------
    // Launching
    // ---------------------------------------------------------------------------------------------

    /// @notice Creates a new HTS token and its SaucerSwap pair. Send at least `quoteLaunchCost()`
    ///         tinybars; anything left after HTS and SaucerSwap fees is refunded.
    /// @param imageUri  Off-chain image (e.g. ipfs:// or https://). Emitted only, not stored.
    /// @param description  Short pitch. Emitted only, not stored.
    function createLaunch(
        string calldata name,
        string calldata symbol,
        string calldata imageUri,
        string calldata description
    ) external payable nonReentrant returns (address token) {
        _validateMetadata(name, symbol, imageUri, description);
        uint256 balanceBefore = address(this).balance - msg.value;

        token = _launchTokenAndPool(name, symbol);
        emit LaunchCreated(token, msg.sender, _launches[token].pair, name, symbol, imageUri, description);

        uint256 unused = address(this).balance - balanceBefore;
        if (unused > 0) _sendHbar(msg.sender, unused);
    }

    // ---------------------------------------------------------------------------------------------
    // Trading
    // ---------------------------------------------------------------------------------------------

    /// @notice Buys tokens with `msg.value` tinybars. If the purchase would overshoot the graduation
    ///         threshold, only the remainder is spent and the excess is refunded; the launch then graduates.
    function buy(address token, uint256 minTokensOut) external payable nonReentrant returns (uint256 tokensOut) {
        Launch storage launch = _activeLaunch(token);
        (uint256 hbarIn, uint256 fee, uint256 refund) = _splitBuyValue(launch.hbarRaised, msg.value);
        tokensOut = _curveTokensOut(launch, hbarIn);
        if (tokensOut == 0) revert ZeroAmount();
        if (tokensOut < minTokensOut) revert SlippageExceeded(tokensOut, minTokensOut);

        launch.hbarRaised += hbarIn;
        launch.tokensLeft -= tokensOut;
        accruedFees += fee;

        IERC20(token).safeTransfer(msg.sender, tokensOut);
        emit Trade(token, msg.sender, true, hbarIn, tokensOut, fee, launch.hbarRaised, launch.tokensLeft);

        if (launch.hbarRaised >= graduationThreshold) _graduate(token, launch);
        if (refund > 0) _sendHbar(msg.sender, refund);
    }

    /// @notice Sells tokens back to the curve. Requires an HTS allowance for this contract
    ///         (`IERC20(token).approve(launchpad, amount)` from the seller).
    function sell(address token, uint256 tokenAmount, uint256 minHbarOut)
        external
        nonReentrant
        returns (uint256 hbarOut)
    {
        Launch storage launch = _activeLaunch(token);
        if (tokenAmount == 0) revert ZeroAmount();

        uint256 gross = BondingCurve.hbarOut(_virtualHbar(launch), _virtualTokens(launch), tokenAmount);
        uint256 fee = (gross * FEE_BPS) / BPS;
        hbarOut = gross - fee;
        if (hbarOut == 0) revert ZeroAmount();
        if (hbarOut < minHbarOut) revert SlippageExceeded(hbarOut, minHbarOut);

        // `gross <= hbarRaised` always holds: the curve pays back at most what was paid in.
        launch.hbarRaised -= gross;
        launch.tokensLeft += tokenAmount;
        accruedFees += fee;

        IERC20(token).safeTransferFrom(msg.sender, address(this), tokenAmount);
        emit Trade(token, msg.sender, false, hbarOut, tokenAmount, fee, launch.hbarRaised, launch.tokensLeft);
        _sendHbar(msg.sender, hbarOut);
    }

    /// @notice Sends accrued trading fees to `feeRecipient`. Callable by anyone.
    function withdrawFees() external nonReentrant {
        uint256 amount = accruedFees;
        accruedFees = 0;
        emit FeesWithdrawn(feeRecipient, amount);
        _sendHbar(feeRecipient, amount);
    }

    // ---------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------

    /// @notice Tinybars to send with `createLaunch` (HTS token budget + SaucerSwap pool fee).
    function quoteLaunchCost() external view returns (uint256) {
        (uint256 tokenCreateBudget, uint256 pairCreateFee) = _launchCosts();
        return tokenCreateBudget + pairCreateFee;
    }

    /// @notice Simulates `buy` for `hbarValue` tinybars.
    /// @return tokensOut Tokens received.
    /// @return fee Protocol fee taken, in tinybars.
    /// @return refund Tinybars returned because the purchase hit the graduation threshold.
    function quoteBuy(address token, uint256 hbarValue)
        external
        view
        returns (uint256 tokensOut, uint256 fee, uint256 refund)
    {
        Launch storage launch = _activeLaunch(token);
        uint256 hbarIn;
        (hbarIn, fee, refund) = _splitBuyValue(launch.hbarRaised, hbarValue);
        tokensOut = _curveTokensOut(launch, hbarIn);
    }

    /// @notice Simulates `sell`. Returns tinybars received after the fee, and the fee.
    function quoteSell(address token, uint256 tokenAmount) external view returns (uint256 hbarOut, uint256 fee) {
        Launch storage launch = _activeLaunch(token);
        uint256 gross = BondingCurve.hbarOut(_virtualHbar(launch), _virtualTokens(launch), tokenAmount);
        fee = (gross * FEE_BPS) / BPS;
        hbarOut = gross - fee;
    }

    /// @notice Curve spot price in tinybars per whole token (10^DECIMALS base units), scaled by `PRICE_SCALE`.
    /// @dev Early prices are below one tinybar per token, so an unscaled integer would round to zero.
    function spotPrice(address token) external view returns (uint256) {
        Launch storage launch = _launches[token];
        if (launch.creator == address(0)) revert UnknownLaunch(token);
        return Math.mulDiv(_virtualHbar(launch), 10 ** DECIMALS * PRICE_SCALE, _virtualTokens(launch));
    }

    function getLaunch(address token) external view returns (Launch memory) {
        Launch memory launch = _launches[token];
        if (launch.creator == address(0)) revert UnknownLaunch(token);
        return launch;
    }

    function launchCount() external view returns (uint256) {
        return _tokens.length;
    }

    /// @notice Paginated list of launches, newest first.
    function getLaunches(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory tokens, Launch[] memory launches)
    {
        uint256 total = _tokens.length;
        uint256 count = offset >= total ? 0 : Math.min(limit, total - offset);
        tokens = new address[](count);
        launches = new Launch[](count);
        for (uint256 i = 0; i < count; i++) {
            address token = _tokens[total - 1 - offset - i];
            tokens[i] = token;
            launches[i] = _launches[token];
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------------------------------

    /// @dev Creates the HTS token and its SaucerSwap pair, associates the LP token and records the launch.
    function _launchTokenAndPool(string calldata name, string calldata symbol) internal returns (address token) {
        (uint256 tokenCreateBudget, uint256 pairCreateFee) = _launchCosts();
        uint256 required = tokenCreateBudget + pairCreateFee;
        if (msg.value < required) revert InsufficientLaunchFee(required, msg.value);

        token = _createHtsToken(name, symbol, tokenCreateBudget);
        address pair = factory.createPair{ value: pairCreateFee }(token, whbar);
        address lpToken = ISaucerSwapV1Pair(pair).lpToken();
        _checkHts(IHederaTokenService(HTS).associateToken(address(this), lpToken));

        _tokens.push(token);
        _launches[token] = Launch({
            creator: msg.sender,
            pair: pair,
            lpToken: lpToken,
            createdAt: uint64(block.timestamp),
            graduated: false,
            hbarRaised: 0,
            tokensLeft: CURVE_SUPPLY
        });
    }

    function _createHtsToken(string calldata name, string calldata symbol, uint256 feeBudget)
        internal
        returns (address token)
    {
        IHederaTokenService.HederaToken memory hederaToken;
        hederaToken.name = name;
        hederaToken.symbol = symbol;
        hederaToken.treasury = address(this);
        hederaToken.tokenSupplyType = true; // FINITE
        hederaToken.maxSupply = int64(uint64(TOTAL_SUPPLY));
        // No keys: the token can never be minted, frozen, wiped, paused or updated.
        hederaToken.tokenKeys = new IHederaTokenService.TokenKey[](0);
        hederaToken.expiry = IHederaTokenService.Expiry({
            second: 0, autoRenewAccount: address(this), autoRenewPeriod: AUTO_RENEW_PERIOD
        });

        int64 responseCode;
        (responseCode, token) = IHederaTokenService(HTS).createFungibleToken{ value: feeBudget }(
            hederaToken, int64(uint64(TOTAL_SUPPLY)), int32(uint32(DECIMALS))
        );
        _checkHts(responseCode);
    }

    /// @dev Moves the curve's HBAR and the reserved supply into SaucerSwap. LP tokens stay here forever.
    function _graduate(address token, Launch storage launch) internal {
        launch.graduated = true;
        uint256 hbarLiquidity = launch.hbarRaised;
        // Rounding dust left on the curve joins the pool instead of being stranded.
        uint256 tokenLiquidity = LIQUIDITY_SUPPLY + launch.tokensLeft;
        launch.hbarRaised = 0;
        launch.tokensLeft = 0;

        // The router pulls exactly `tokenLiquidity` from an empty pool, consuming the allowance. Any remainder (pre-seeded
        // pool) is unusable: the router only moves tokens from its caller, and only this contract calls it for this token.
        IERC20(token).forceApprove(address(router), tokenLiquidity);
        uint256 balanceBefore = address(this).balance - hbarLiquidity;
        // The pair is empty unless someone seeded it before graduation; in that case the router adds at the
        // pool's ratio and returns unused HBAR, which we credit to fees rather than let it sit unaccounted.
        (uint256 tokenAdded, uint256 hbarAdded, uint256 lpTokens) = router.addLiquidityETH{ value: hbarLiquidity }(
            token, tokenLiquidity, 0, 0, address(this), block.timestamp
        );
        accruedFees += address(this).balance - balanceBefore;

        emit Graduated(token, launch.pair, hbarAdded, tokenAdded, lpTokens);
    }

    /// @dev Splits a buy's msg.value into curve input, fee and refund, capping input at the threshold.
    function _splitBuyValue(uint256 hbarRaised, uint256 value)
        internal
        view
        returns (uint256 hbarIn, uint256 fee, uint256 refund)
    {
        if (value == 0) revert ZeroAmount();
        fee = (value * FEE_BPS) / BPS;
        hbarIn = value - fee;
        uint256 remaining = graduationThreshold - hbarRaised;
        if (hbarIn > remaining) {
            hbarIn = remaining;
            fee = Math.mulDiv(hbarIn, FEE_BPS, BPS - FEE_BPS, Math.Rounding.Ceil);
            refund = value - hbarIn - fee;
        }
    }

    function _launchCosts() internal view returns (uint256 tokenCreateBudget, uint256 pairCreateFee) {
        IExchangeRate rates = IExchangeRate(EXCHANGE_RATE);
        tokenCreateBudget = rates.tinycentsToTinybars(TOKEN_CREATE_BUDGET_TINYCENTS);
        pairCreateFee = rates.tinycentsToTinybars(factory.pairCreateFee());
    }

    function _activeLaunch(address token) internal view returns (Launch storage launch) {
        launch = _launches[token];
        if (launch.creator == address(0)) revert UnknownLaunch(token);
        if (launch.graduated) revert AlreadyGraduated(token);
    }

    /// @dev Curve output capped at the tokens actually left: flooring `threshold / 3` and `curveSupply / 3`
    ///      makes the final buy compute slightly more than remains (a few hundred tokens at most).
    function _curveTokensOut(Launch storage launch, uint256 hbarIn) internal view returns (uint256) {
        return Math.min(BondingCurve.tokensOut(_virtualHbar(launch), _virtualTokens(launch), hbarIn), launch.tokensLeft);
    }

    function _virtualHbar(Launch storage launch) internal view returns (uint256) {
        return BondingCurve.virtualHbar(graduationThreshold, launch.hbarRaised);
    }

    function _virtualTokens(Launch storage launch) internal view returns (uint256) {
        return BondingCurve.virtualTokens(CURVE_SUPPLY, launch.tokensLeft);
    }

    function _validateMetadata(
        string calldata name,
        string calldata symbol,
        string calldata imageUri,
        string calldata description
    ) internal pure {
        uint256 nameLength = bytes(name).length;
        uint256 symbolLength = bytes(symbol).length;
        if (
            nameLength == 0 || nameLength > 64 || symbolLength == 0 || symbolLength > 16 || bytes(imageUri).length > 256
                || bytes(description).length > 512
        ) revert InvalidMetadata();
    }

    function _checkHts(int64 responseCode) internal pure {
        if (responseCode != HederaResponseCodes.SUCCESS) revert HtsCallFailed(responseCode);
    }

    function _sendHbar(address to, uint256 amount) internal {
        (bool ok,) = to.call{ value: amount }("");
        if (!ok) revert HbarTransferFailed(to, amount);
    }
}
