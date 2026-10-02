# Launchpad — product brief

## Who it is for

Builders who want a fair-launch token product on Hedera: a creator launches a token in one transaction, the market
prices it on a bonding curve, and once enough HBAR is raised the token trades on SaucerSwap with liquidity nobody can pull.

## What the app must do

1. **Browse launches.** The home page lists launches (newest first) with image, name, symbol, market cap and graduation
   progress. It works with no wallet connected.
2. **Launch a token.** `/create` takes name, symbol, optional image URL and description, shows the exact launch cost
   (HTS creation + SaucerSwap pool fee, converted from USD on-chain) and calls `Launchpad.createLaunch`. On success it
   navigates to the new token page.
3. **Trade on the curve.** `/token/[address]` shows a buy/sell panel with live quotes (`quoteBuy` / `quoteSell`), 1%
   slippage protection, a one-click HTS approval for sells, and an association prompt for accounts that cannot
   auto-associate.
4. **Graduate.** The buy that crosses the threshold seeds the SaucerSwap pair and locks the LP tokens. The token page
   then swaps the curve panel for a SaucerSwap panel quoting from the router.
5. **History.** A market-cap candlestick chart and a trades table are built from mirror-node logs (curve `Trade` events,
   then SaucerSwap `Sync` events). No database.
6. **Talk.** Each token has a comment thread stored on an HCS topic; comments are wallet-signed and relayed by
   `/api/comments`. Without `NEXT_PUBLIC_HCS_TOPIC_ID` the thread shows how to enable it instead of failing.

## Non-goals

- Admin functions, upgradeability, or any way to move locked LP tokens.
- A backend database or custom indexer.
- Local-chain support (HTS and SaucerSwap only exist on Hedera networks).

## Constraints

- Contract amounts are tinybars (8 decimals); transaction `value` is weibars (18 decimals).
- Curve constants are mirrored between `Launchpad.sol` and `utils/launchpad/curve.ts` and must stay in sync.
- No secrets in the repo. The HCS operator key is server-only.
