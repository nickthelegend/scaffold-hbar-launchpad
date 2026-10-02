# HBAR Launchpad — a Scaffold-HBAR template

Fair-launch tokens on Hedera: mint a fixed-supply **HTS** token, sell it on a **bonding curve**, and when the curve fills, **graduate** it into a **SaucerSwap** pool whose liquidity is locked forever. Trades are charted and listed straight from the **mirror node**, and every token gets a wallet-signed comment thread on **HCS**.

```bash
npm create scaffold-hbar@latest -- --template nickthelegend/scaffold-hbar-launchpad
```

| | |
|---|---|
| **Hedera services** | HTS (contract-created token, freeze key as an anti-sniping guard) · Exchange Rate system contract · HIP-719 association · HCS · Mirror Node REST |
| **Ecosystem integration** | SaucerSwap V1: pool creation, liquidity seeding and locking, post-graduation swaps and quotes |
| **Stack** | Foundry · Next.js App Router · RainbowKit/wagmi/viem · Yarn workspaces · Node ≥ 20.18.3 |
| **Live on testnet** | Launchpad [`0.0.10831212`](https://hashscan.io/testnet/contract/0.0.10831212) · graduated token [`HCAT 0.0.10831221`](https://hashscan.io/testnet/token/0.0.10831221) · HCS topic [`0.0.10830947`](https://hashscan.io/testnet/topic/0.0.10830947) |
| **Tested against** | the real SaucerSwap V1 contracts on a Hedera testnet fork: no protocol mocks |

---

## Contents

1. [Why this template](#why-this-template)
2. [Quick start](#quick-start)
3. [How it works](#how-it-works)
4. [Architecture](#architecture)
5. [Project structure](#project-structure)
6. [Configuration](#configuration)
7. [Deploy your own](#deploy-your-own)
8. [Testing](#testing)
9. [Testnet proof](#testnet-proof)
10. [Hedera gotchas this template handles](#hedera-gotchas-this-template-handles)
11. [Customising](#customising)
12. [Security considerations](#security-considerations)
13. [AI-assisted development](#ai-assisted-development)

---

## Why this template

A token launchpad is one of the most common things people build on any chain. On Hedera, building one well means stitching together pieces that are each easy to get wrong:

- creating an HTS token **from a contract**, paying the creation fee in HBAR, and giving up every admin key so holders can trust the supply;
- pricing a curve correctly when HBAR has **8 decimals inside the EVM but 18 over JSON-RPC**;
- dealing with **token association** for buyers;
- paying SaucerSwap's pool-creation fee, which is set **in USD** and must be converted on-chain;
- associating the launchpad with an **LP token that does not exist yet**, so it can hold (and lock) it;
- indexing trades without running an indexer.

This template does all of that, with tests, and a UI you can ship. Swap the branding and the curve parameters, and you have a product.

## Quick start

**Prerequisites**

| Tool | Version | Notes |
|---|---|---|
| Node.js | ≥ 20.18.3 | |
| Yarn | via Corepack | `corepack enable` |
| Foundry | ≥ 1.0 | `curl -L https://foundry.paradigm.xyz \| bash && foundryup` |
| Git | any | `user.name` / `user.email` set (the CLI makes the first commit) |
| An EVM wallet on Hedera testnet | — | MetaMask, HashPack (EVM), Rabby… with testnet HBAR from the [portal faucet](https://portal.hedera.com/faucet) |

**1. Scaffold and run**

```bash
npm create scaffold-hbar@latest -- --template nickthelegend/scaffold-hbar-launchpad
cd my-hedera-dapp
yarn next:dev
```

Open http://localhost:3000. The frontend ships wired to the shared testnet Launchpad recorded in `packages/nextjs/contracts/deployedContracts.ts`, so you can launch, trade and graduate tokens immediately, without deploying anything. The shared deployment graduates at **1 HBAR**, so the whole lifecycle fits in a faucet drip. Your own deployments default to 100 HBAR.

**2. Launch a token.** Go to **Create**, enter a name and symbol and confirm. Launching costs about $3 in HBAR (HTS token creation plus SaucerSwap's $2 pool fee); the exact amount is quoted on the page and any excess is refunded.

**3. Trade it.** Buy and sell on the token page. The progress bar fills as HBAR is raised; the buy that crosses the threshold moves liquidity into SaucerSwap and the page switches to a SaucerSwap trade panel.

## How it works

### Lifecycle

```mermaid
sequenceDiagram
    actor Creator
    actor Trader
    participant LP as Launchpad.sol
    participant HTS as HTS (0x167)
    participant FX as Exchange rate (0x168)
    participant SS as SaucerSwap V1

    Creator->>LP: createLaunch(name, symbol, image, description) + HBAR
    LP->>FX: tinycentsToTinybars($1.30 budget, $2 pool fee)
    LP->>HTS: createFungibleToken(1B supply, only key = freeze held by LP, treasury = LP)
    LP->>SS: factory.createPair(token, WHBAR) — pays pool fee
    LP->>HTS: associateToken(LP, pair.lpToken())
    LP->>HTS: freezeToken(token, pair) — nobody can seed the pool early
    LP-->>Creator: refund unused HBAR

    loop until threshold HBAR raised
        Trader->>LP: buy(token, minOut) + HBAR / sell(token, amount, minOut)
        LP-->>Trader: tokens / HBAR (1% fee)
    end

    Trader->>LP: buy that crosses the threshold
    LP->>HTS: unfreezeToken(token, pair)
    LP->>SS: transfer 200M tokens + WHBAR.deposit(threshold HBAR) → pair.mint(LP)
    Note over LP,SS: LP tokens stay in Launchpad — no function can move them
    Trader->>SS: swapExactETHForTokens / swapExactTokensForETH
```

### Supply and pricing

Every launch mints **1,000,000,000** tokens (8 decimals) to the Launchpad:

- **800M** are sold on the bonding curve;
- **200M** are reserved for the SaucerSwap pool at graduation.

The curve is constant-product over **virtual reserves**: `virtualHbar = threshold/3 + hbarRaised` and `virtualTokens = 800M/3 + tokensLeft`. Those offsets are not arbitrary. They are the unique values for which:

1. raising exactly `threshold` HBAR sells exactly the 800M curve tokens; and
2. the curve's **final price equals the SaucerSwap pool's opening price** (`threshold / 200M`).

So graduation causes no price jump and no free arbitrage. The price rises 16× from first buy to graduation. The derivation is in [`BondingCurve.sol`](packages/foundry/contracts/libraries/BondingCurve.sol), and the property is fuzz-tested in [`BondingCurve.t.sol`](packages/foundry/test/BondingCurve.t.sol).

A buy that would overshoot the threshold only spends what the curve needs and refunds the rest in the same transaction; that buy triggers graduation. The 1% trading fee accrues in the contract and anyone can push it to `feeRecipient` with `withdrawFees()`.

### Hedera services used, and why

| Service | Where | Why it is load-bearing |
|---|---|---|
| **HTS** via system contract `0x167` | `Launchpad._createHtsToken` | The token is a native HTS token created **by the contract** with **no admin, supply, wipe, pause or KYC key** and a finite max supply. Its one key is a **freeze key held by the immutable Launchpad**, whose only use is freezing the token's own SaucerSwap pair until graduation, so nobody can pre-seed the pool at a skewed price and skim the graduation liquidity. Supply is provably fixed and nobody can freeze holders. Native tokens show up in every Hedera wallet and explorer. |
| **Exchange Rate** system contract `0x168` | `Launchpad._launchCosts` | HTS and SaucerSwap price their fees in USD. The contract converts them to tinybars at execution time, so the launch quote is always right. |
| **HIP-719 / HIP-904 association** | `associateToken` for the LP token; `useTokenAssociation` + `AssociationNotice` in the UI | Pairs, LP tokens and buyers must be associated. The Launchpad associates itself with the LP token at launch, and the UI detects accounts without free auto-association slots and offers one-click `token.associate()`. |
| **HCS** | `app/api/comments`, `useComments` | Each token's comment thread is an ordered, timestamped, tamper-evident log on a consensus topic. Comments carry the author's wallet signature, so the relayer cannot forge them. |
| **Mirror Node REST** | `utils/launchpad/mirror.ts` | Free, hosted indexer: launch metadata, trade history, graduation and SaucerSwap pool syncs for charts are read from contract logs, so there is no database or subgraph to run. |
| **SaucerSwap V1** (ecosystem) | `Launchpad._graduate`, `SaucerSwapTradePanel` | The pool is created at launch and seeded at graduation, the LP is locked, and post-graduation trading and quotes go through the router. Without SaucerSwap there is no exit liquidity: the integration is the product. |

## Architecture

```mermaid
flowchart LR
  subgraph Browser
    UI[Next.js pages<br/>/, /create, /token/:address]
    Hooks[hooks/launchpad]
  end
  subgraph Next.js server
    API["/api/comments<br/>verify signature → HCS"]
  end
  subgraph Hedera
    LP[Launchpad.sol]
    HTS[(HTS tokens)]
    SS[SaucerSwap V1<br/>factory · router · pairs]
    HCS[(HCS topic)]
    MN[Mirror Node REST]
  end
  UI --> Hooks
  Hooks -- "reads/writes (JSON-RPC, Hashio)" --> LP
  Hooks -- "quotes/swaps after graduation" --> SS
  Hooks -- "logs, balances, topic messages" --> MN
  Hooks -- "signed comment" --> API --> HCS
  LP --> HTS
  LP --> SS
  HCS --> MN
  LP -. logs .-> MN
  SS -. Sync logs .-> MN
```

**Contract** ([`packages/foundry/contracts`](packages/foundry/contracts))
- `Launchpad.sol`: launch, curve trading, graduation, fee withdrawal, paginated views and quotes for the UI.
- `libraries/BondingCurve.sol`: pure pricing math.
- `interfaces/ISaucerSwapV1.sol`, `interfaces/IExchangeRate.sol`: the minimal external surface used.

**Frontend** ([`packages/nextjs`](packages/nextjs))
- `utils/launchpad/`: framework-free logic (units, curve math mirrored from Solidity, candles, mirror-node client, HCS comment schema). Unit-tested with Vitest.
- `hooks/launchpad/`: React Query + wagmi hooks that compose the above.
- `components/launchpad/`: cards, trade panels (curve and SaucerSwap), chart, trades table, comment thread.
- `contracts/externalContracts.ts`: SaucerSwap router addresses and ABI for testnet and mainnet.

## Project structure

```
.
├── template.json                 # create-scaffold-hbar manifest (removed from scaffolded projects)
├── AGENTS.md / CLAUDE.md         # briefing for coding agents
├── .harness/                     # Hedera Harness recipe + validators used to verify this template
└── packages/
    ├── foundry/
    │   ├── contracts/
    │   │   ├── Launchpad.sol
    │   │   ├── interfaces/{ISaucerSwapV1,IExchangeRate}.sol
    │   │   └── libraries/BondingCurve.sol
    │   ├── script/Deploy.s.sol    # deploys Launchpad wired to SaucerSwap for the current chain
    │   ├── scripts-js/demo.js     # end-to-end lifecycle on testnet, prints HashScan links
    │   └── test/
    │       ├── Launchpad.t.sol    # 26 integration tests vs real SaucerSwap on a testnet fork
    │       ├── BondingCurve.t.sol # pricing properties (fuzz)
    │       └── utils/             # fork wiring: HTS emulator adapters, live exchange rate
    └── nextjs/
        ├── app/
        │   ├── page.tsx           # launch grid
        │   ├── create/page.tsx    # launch form
        │   ├── token/[address]/   # token page: chart, trades, comments, trade panel
        │   └── api/comments/      # HCS relayer
        ├── components/launchpad/
        ├── hooks/launchpad/
        ├── utils/launchpad/       # + __tests__/
        └── scripts/createCommentsTopic.mjs
```

## Configuration

### `packages/nextjs/.env.local` (all optional)

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` | Scaffold-HBAR demo id | WalletConnect project id. Get your own at cloud.reown.com for production. |
| `NEXT_PUBLIC_HEDERA_TESTNET_RPC_URL` | `https://testnet.hashio.io/api` | JSON-RPC relay. |
| `NEXT_PUBLIC_MIRROR_NODE_TESTNET_URL` | `https://testnet.mirrornode.hedera.com` | Mirror node used as the indexer. |
| `NEXT_PUBLIC_HEDERA_NETWORK` | `testnet` | Network for the HCS relayer and topic script. |
| `NEXT_PUBLIC_HCS_TOPIC_ID` | unset (comments off) | Topic holding comment threads. |
| `HEDERA_OPERATOR_ID` / `HEDERA_OPERATOR_KEY` | unset | **Server-only.** ECDSA account that pays for HCS messages; must be the topic's submit key. |

Mainnet variants (`*_MAINNET_*`) exist for the RPC and mirror URLs.

### `packages/foundry/.env` (created from `.env.example` on install)

| Variable | Default | Purpose |
|---|---|---|
| `GRADUATION_THRESHOLD_HBAR` | `100` | HBAR a curve must raise before graduating. The shared testnet deployment uses 1, so the lifecycle is cheap to try. |
| `FEE_RECIPIENT` | deployer | Receives the 1% curve fee. |
| `HEDERA_RPC_URL` | Hashio testnet | RPC for fork tests and the demo script. |
| `DEMO_PRIVATE_KEY` | unset | Non-interactive signer for `yarn foundry:demo`. Never commit it. |

### Enabling comments

```bash
# 1. put an ECDSA testnet account in packages/nextjs/.env.local
HEDERA_OPERATOR_ID=0.0.xxxxx
HEDERA_OPERATOR_KEY=0x...
# 2. create the topic (submit key = operator)
yarn next:hcs:create-topic
# 3. paste the printed NEXT_PUBLIC_HCS_TOPIC_ID into .env.local and restart
```

## Deploy your own

```bash
yarn foundry:account:generate            # or foundry:account:import; fund it from the faucet
yarn foundry:test                        # 30 tests, real SaucerSwap on a testnet fork
yarn deploy --network hedera_testnet     # deploys Launchpad + regenerates deployedContracts.ts
yarn foundry:demo --graduate             # optional: full lifecycle on testnet with HashScan links
yarn next:dev
```

`Deploy.s.sol` picks the SaucerSwap V1 router for the chain (testnet `0.0.19264`, mainnet `0.0.3045981`) and reads the factory and WHBAR from it. A local Anvil chain is not supported, because it has no HTS or SaucerSwap; use testnet, or the forked test suite, for development.

**Hosting the frontend**: it is a standard Next.js app. On Railway or Vercel set the root directory to `packages/nextjs` (or use the root `yarn next:build` / `yarn next:serve`), and set the env vars above. `HEDERA_OPERATOR_KEY` must only be set as a server secret.

## Testing

```bash
yarn foundry:test   # Solidity: integration tests against real SaucerSwap on a testnet fork, plus curve properties
yarn next:test      # Vitest: curve maths, candles, mirror client, comment signing
yarn lint && yarn next:check-types && yarn next:build
```

**No protocol mocks.** `Launchpad.t.sol` forks Hedera testnet at a pinned block (`ForkTestBase.FORK_BLOCK`) and runs against the **deployed SaucerSwap V1 factory, router, pairs and WHBAR**. Pools are created by SaucerSwap's factory, liquidity goes through its router, and LP tokens are real HTS tokens minted by real pairs. Hedera's native services are not EVM bytecode, so the fork wires them in:

| Address | What runs there in the fork | Source of truth |
|---|---|---|
| `0x167` HTS | [`hedera-forking`](https://github.com/hashgraph/hedera-forking)'s HTS emulator | Real token, balance and account state from the mirror node |
| `0x168` exchange rate | [`LiveExchangeRate`](packages/foundry/test/utils/LiveExchangeRate.sol) | The network's current rate from `/network/exchangerate` |

Getting real SaucerSwap to run in a fork required three adapters, each documented in [`test/utils/`](packages/foundry/test/utils):

- [`HtsV1Compat`](packages/foundry/test/utils/HtsV1Compat.sol): SaucerSwap (2022) calls HTS through the **v1 ABI** (`uint32`/`uint64` amounts). The emulator only speaks v2, so v1 calls are re-dispatched with `delegatecall`, preserving the caller for supply-key checks.
- [`HtsContractKeyRouter`](packages/foundry/test/utils/HtsContractKeyRouter.sol) and [`ContractKeys`](packages/foundry/test/utils/ContractKeys.sol): **contract keys**. WHBAR's supply key is the WHBAR contract, and SaucerSwap's fee account is keyed by its factory. The mirror node serves these keys protobuf-encoded, so they are verified against the real key bytes instead of being ignored.
- [`ForkMirrorNode`](packages/foundry/test/utils/ForkMirrorNode.sol): contracts created inside the fork (the Launchpad, new pairs) are accounts on Hedera from birth, but the real mirror node has never seen them.
- `ForkTestBase._useRealHtsToken`: Hashio now reports HTS token code as an EIP-7702 delegation (`0xef0100…0167`). Tokens the tests touch get the HIP-719 proxy the emulator expects.

The suite needs network access (Hashio RPC and mirror node) and caches RPC responses for the pinned block. A full run takes about 3 minutes.

What is covered: launch accounting and refunds, metadata validation, USD fee conversion at the live rate, quotes matching execution, slippage, allowances, round-trip fee loss, threshold overshoot refunds, graduation seeding and locking in the real pool, price continuity, **swapping a graduated token on SaucerSwap**, post-graduation lockout, a pool pre-seeded through SaucerSwap's own router, pagination, fee withdrawal, and a fuzz regression for the closing-buy rounding bug. [`BondingCurve.t.sol`](packages/foundry/test/BondingCurve.t.sol) fuzzes the pricing properties.

The same lifecycle on the live network is `yarn foundry:demo --graduate`.

## Testnet proof

The shared deployment the scaffolded frontend uses, with one token taken through the whole lifecycle on Hedera testnet:

| Step | Evidence |
|---|---|
| Launchpad deployed (graduation at 1 HBAR) | contract [`0.0.10831212`](https://hashscan.io/testnet/contract/0.0.10831212) · [deploy tx](https://hashscan.io/testnet/transaction/0x09dbe5c31e8f3c2d702b006b581b7e2b5ed406f3d306add9143c76f0bdfcacec) |
| **Launch.** `createLaunch` creates the HTS token `HCAT` from the contract, creates its SaucerSwap pair through the factory (USD fee converted via `0x168`), associates the LP token, and refunds the unused HTS budget | [0x1b22…fd35](https://hashscan.io/testnet/transaction/0x1b2255778a8332000042b7735f170a1c15eab2fc2c982096c489b07458e7fd35) · token [`0.0.10831221`](https://hashscan.io/testnet/token/0.0.10831221) · pair [`0.0.10831222`](https://hashscan.io/testnet/contract/0.0.10831222) |
| **Graduate.** A buy crosses the threshold; the overshoot is refunded; 1 HBAR plus 200M HCAT are deposited through SaucerSwap's router; 1.414e12 LP tokens are locked in the Launchpad | [0xc43f…c819](https://hashscan.io/testnet/transaction/0xc43f3969eedb4e5ecb674889eb537406b3901c8259eb96b702254a04cef6c819) · LP token [`0.0.10831223`](https://hashscan.io/testnet/token/0.0.10831223) |
| **Trade on SaucerSwap.** `swapExactETHForTokens` against the new pool | [0x1e1a…fbe6](https://hashscan.io/testnet/transaction/0x1e1acba837fbcb828618fdf892bf22364a75d7acd6a803d2631d3ee361f7fbe6) |
| **HCS comment.** A wallet-signed comment relayed to the comments topic | topic [`0.0.10830947`](https://hashscan.io/testnet/topic/0.0.10830947), message #1 |

> **Note.** The shared deployment above was made just before the pool-freeze guard (see Security considerations) was added, so its HCAT pool was not frozen pre-graduation. The guard is exercised against real SaucerSwap in the fork tests (`test_createLaunch_freezesPoolUntilGraduation`, `test_frozenPool_cannotBeSeededBeforeGraduation`). `yarn deploy --network hedera_testnet` deploys the current contract.

Curve `sell` with an HTS allowance, from an earlier development build (`0.0.10829745`): [buy](https://hashscan.io/testnet/transaction/0xec8809f667bd729aa3ea5518b7a79cfb713ca01f3ff24a9c13a435522675c06b) · [sell](https://hashscan.io/testnet/transaction/0x6bf0b18687f4463171f4d19aad0a299a03d2577738ccf4b390a298ae6830d670).

Live testing also caught two real bugs, both fixed and covered by tests:

1. Flooring `threshold / 3` made the closing buy compute ~200 more tokens than were left, so graduation reverted. Output is now capped at `tokensLeft`.
2. At small thresholds the price is below one tinybar per token, so integer prices read as 0. Prices are now 1e18-scaled.

## Hedera gotchas this template handles

| Gotcha | What happens | How the template deals with it |
|---|---|---|
| **Two HBAR decimal conventions** | Inside the EVM, `msg.value` and balances are **tinybars (8 dp)**. A transaction's `value` over JSON-RPC is **weibars (18 dp)**. | Contract math is in tinybars. The UI converts with `tinybarsToWeibars()` only when setting `value` ([`units.ts`](packages/nextjs/utils/launchpad/units.ts)). |
| **Sub-tinybar prices** | A token can be worth less than 1 tinybar, so integer prices round to 0. | `spotPrice` and UI prices are scaled by 1e18 (`PRICE_SCALE`). |
| **USD-denominated fees** | SaucerSwap's `pairCreateFee` is in tinycents; HTS creation costs ~$1. | Converted on-chain through `0x168`; `quoteLaunchCost()` gives the UI an exact number, and the excess is refunded. |
| **Expensive HTS operations** | `createPair` deploys a pair and creates and associates an HTS LP token: ~7M gas. `createLaunch` totals ~7.4M. | Gas comes from `eth_estimateGas` (Hashio simulates HTS correctly). Hedera bills at least 80% of the gas limit, so the demo script pads estimates by only 5%. |
| **Association** | Accounts can only hold HTS tokens they are associated with, or have auto-association slots for. Wallet-created EVM accounts default to unlimited (HIP-904); others do not. | The contract associates itself with the LP token at launch. The UI checks the mirror node and offers `token.associate()` (HIP-719) when needed. |
| **LP token unknown until the pair exists** | You cannot associate with a token that does not exist yet. | The pair is created at launch, so its LP token can be associated before graduation mints LP to the Launchpad. |
| **Mirror node topic queries** | Log queries filtered by topic must span ≤ 7 days. | `MirrorNodeClient.getLogs` walks 7-day windows from each launch's on-chain `createdAt` and follows pagination. |
| **Wallets cannot sign HCS transactions** | EVM wallets only sign EVM transactions. | Comments are `personal_sign`ed and relayed by `/api/comments`; the signature is stored in the message, so anyone can verify authorship. |

## Customising

| Want to… | Change |
|---|---|
| Graduate at a different raise | `GRADUATION_THRESHOLD_HBAR` at deploy time. |
| Change the fee | `FEE_BPS` in `Launchpad.sol` (and `FEE_BPS` in `utils/launchpad/curve.ts`). |
| Change supply or split | `TOTAL_SUPPLY` / `CURVE_SUPPLY` in `Launchpad.sol` **and** `curve.ts`. The virtual-reserve formula assumes `LIQUIDITY_SUPPLY = CURVE_SUPPLY / 4`; re-derive it if you change the split (see the comment in `BondingCurve.sol`). |
| Give creators a share | Add a creator fee split in `buy`/`sell` and track it alongside `accruedFees`. |
| Go to mainnet | `yarn deploy --network hedera_mainnet` (router `0.0.3045981` is preconfigured), then set `targetNetworks` in `scaffold.config.ts`. |
| Use SaucerSwap V2 | Replace `_graduate` with a full-range mint on the V2 `NonfungiblePositionManager`. The LP position is an NFT from a single known HTS collection, so it can be associated in the constructor. |

## Security considerations

This is a template, **not audited software**. Notable design points:

- **No admin.** The Launchpad has no owner, no pause and no upgrade path. Tokens have no admin, supply, wipe or pause key, so supply is fixed and balances cannot be confiscated. LP tokens can never leave the contract.
- **Pool front-running.** Because the pair exists from launch, anyone holding tokens could otherwise add liquidity before graduation at a skewed price and capture part of the graduation liquidity. The Launchpad **freezes the pair's token account** (HTS freeze key, held only by the immutable contract) until graduation: the router and direct transfers into the pool both fail (`test_frozenPool_cannotBeSeededBeforeGraduation`). WHBAR can still be donated to the pair, but graduation mints directly on the pair, so a donation cannot block it and simply stays with the locked LP (`test_graduation_ignoresWhbarDonatedToPool`). The freeze key is held by code with no path to freeze anyone else.
- **Reentrancy.** All state-changing entry points are `nonReentrant`. Trades update curve state before transferring tokens or HBAR. The contract has no `receive()`, so stray HBAR transfers are rejected.
- **Slippage.** `buy`, `sell` and SaucerSwap swaps take minimum-out parameters; the UI uses 1%.
- **Comment relayer.** The relayer can censor or delay comments but cannot forge them. Signatures expire after 5 minutes to limit replay. Smart-contract wallets (EIP-1271) are not supported by `verifyMessage` as written.
- **Fees.** `withdrawFees()` is permissionless but always pays `feeRecipient`.

## AI-assisted development

- [`AGENTS.md`](AGENTS.md) briefs coding agents (Claude Code, Cursor, Codex) on commands, layout, invariants and Hedera pitfalls. `CLAUDE.md` includes it.
- [`.harness/`](.harness) holds the [Hedera Harness](https://github.com/hedera-dev/hedera-harness) recipe and validators used to verify this template: install and build gates, secret scanning, Playwright route smoke tests and an adversarial contract. Run `npx hedera-harness doctor` and then `npx hedera-harness run` to extend the template with a PRD of your own.
- Hedera Skills (`npx skills add hedera-dev/hedera-skills`) are installed by the CLI by default.

## License

[MIT](LICENCE).
