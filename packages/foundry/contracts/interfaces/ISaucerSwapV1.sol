// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal surface of SaucerSwap V1 (a Uniswap V2 fork adapted to HTS) used by the launchpad.
/// @dev Source: https://github.com/saucerswaplabs/saucerswaplabs-core and saucerswap-periphery.
///      Fees on SaucerSwap are denominated in tinycents and converted to tinybars on-chain through the
///      Hedera exchange rate system contract (0x168), so callers must quote them at execution time.

interface ISaucerSwapV1Factory {
    /// Pool creation fee in tinycents (1e-8 US cents). Paid in HBAR as msg.value on `createPair`.
    function pairCreateFee() external view returns (uint256);

    function getPair(address tokenA, address tokenB) external view returns (address pair);

    /// Deploys a pair and creates its HTS LP token. Requires msg.value >= tinybar value of `pairCreateFee`.
    function createPair(address tokenA, address tokenB) external payable returns (address pair);
}

interface ISaucerSwapV1Pair {
    /// HTS fungible token representing pool shares (created by the pair itself on Hedera).
    function lpToken() external view returns (address);

    /// Mints LP tokens to `to` for the token balances transferred in since the last update (Uniswap V2 semantics).
    function mint(address to) external returns (uint256 liquidity);

    function token0() external view returns (address);

    function token1() external view returns (address);

    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
}

interface ISaucerSwapV1Router {
    function factory() external view returns (address);

    /// The WHBAR wrapper contract.
    function WHBAR() external view returns (address);

    /// The HTS token minted by the WHBAR wrapper; this is the token paired in pools.
    function whbar() external view returns (address);

    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);

    function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        payable
        returns (uint256[] memory amounts);

    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);
}

/// @notice SaucerSwap's WHBAR wrapper: wraps HBAR into the WHBAR HTS token.
interface IWHBAR {
    /// Wraps `msg.value` and sends the WHBAR tokens to `dst`.
    function deposit(address src, address dst) external payable;
}
