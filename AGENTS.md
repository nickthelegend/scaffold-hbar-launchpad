# Agent instructions

Briefing for coding agents (Claude Code, Cursor, Codex) working in this repo. Claude Code loads it through `CLAUDE.md`. Read `README.md` → "How it works" before changing contract logic.

## What this is

A Scaffold-HBAR template for a **token launchpad**: `Launchpad.sol` creates keyless, fixed-supply HTS tokens, sells 80% on a bonding curve, and on reaching `graduationThreshold` seeds a **SaucerSwap V1** pool with the raised HBAR plus the remaining 20%, locking the LP tokens in the contract forever. The Next.js app lists launches, trades on the curve or on SaucerSwap after graduation, charts history from the **mirror node**, and stores comment threads on **HCS**.

- `packages/foundry`: contracts, deploy script, tests, demo script. Foundry only (no Hardhat package).
- `packages/nextjs`: App Router frontend (RainbowKit, wagmi, viem, DaisyUI, React Query).

Use Yarn (`packageManager` in the root `package.json`). Run scripts from the repo root.

## Commands

```bash
yarn foundry:test                       # contract tests vs real SaucerSwap on a testnet fork (~3 min, needs network)
yarn foundry:lint                       # forge fmt --check + prettier
yarn foundry:format
yarn next:test                          # vitest (utils/launchpad/__tests__)
yarn next:lint && yarn next:check-types
yarn next:build
yarn next:dev                           # http://localhost:3000

yarn foundry:account:generate           # deployer keystore
yarn deploy --network hedera_testnet    # deploy Launchpad + regenerate nextjs/contracts/deployedContracts.ts
yarn foundry:demo [--graduate]          # live lifecycle on testnet, prints HashScan links (spends HBAR)
yarn next:hcs:create-topic              # create the comments topic (needs operator env in nextjs/.env.local)
```

Before finishing any change, run `yarn foundry:test`, `yarn next:test`, `yarn next:check-types` and `yarn next:lint`. Run `yarn next:build` if you touched pages or config.

## Layout

| Path | Contents |
|---|---|
| `packages/foundry/contracts/Launchpad.sol` | All on-chain logic. Sections: launching, trading, views, internals. |
| `packages/foundry/contracts/libraries/BondingCurve.sol` | Pure pricing math. Doc comment derives the virtual reserves. |
| `packages/foundry/contracts/interfaces/` | `ISaucerSwapV1` (factory, pair, router subset), `IExchangeRate` (0x168). HTS types come from `hedera-forking/IHederaTokenService.sol`. |
| `packages/foundry/script/Deploy.s.sol` | Picks the SaucerSwap router per chain id (296 testnet, 295 mainnet). |
| `packages/foundry/scripts-js/demo.js` | ethers v5 end-to-end script. |
| `packages/foundry/test/` | `Launchpad.t.sol` (fork integration), `BondingCurve.t.sol` (fuzz), `utils/` (fork wiring: `ForkTestBase`, `HtsV1Compat`, `HtsContractKeyRouter`, `ContractKeys`, `ForkMirrorNode`, `LiveExchangeRate`). |
| `packages/nextjs/utils/launchpad/` | Framework-free logic: `units`, `curve`, `candles`, `activity`, `mirror`, `comments`, `htsToken`. Tests in `__tests__/`. |
| `packages/nextjs/hooks/launchpad/` | `useLaunchpad`, `useLaunchData`, `useTokenAssociation`, `useComments`. |
| `packages/nextjs/components/launchpad/` | UI pieces. Trade panels: `CurveTradePanel`, `SaucerSwapTradePanel`. |
| `packages/nextjs/app/` | `page.tsx` (grid), `create/`, `token/[address]/`, `api/comments/` (HCS relayer). |
| `packages/nextjs/contracts/deployedContracts.ts` | **Generated** by `yarn deploy`. Do not hand-edit. |
| `packages/nextjs/contracts/externalContracts.ts` | SaucerSwap router address + ABI subset per chain. |
| `.harness/` | Hedera Harness recipe and validators. |

## Invariants: do not break these

1. **Units.** Contract amounts are **tinybars (8 dp)** and token base units (8 dp). Only a transaction's `value` is in **weibars (18 dp)**: always `tinybarsToWeibars(x)` when setting `value` in the UI, and never pass weibars as a contract argument.
2. **Curve constants are duplicated.** `TOTAL_SUPPLY`, `CURVE_SUPPLY`, `FEE_BPS`, `PRICE_SCALE` and the virtual-reserve formula exist in both `Launchpad.sol`/`BondingCurve.sol` **and** `utils/launchpad/curve.ts`. Change both, then run both test suites.
3. **`LIQUIDITY_SUPPLY = CURVE_SUPPLY / 4`** is what makes `threshold/3` and `curveSupply/3` the right offsets (price continuity at graduation). If you change the split, re-derive the offsets and update `testFuzz_finalPriceMatchesPoolPrice`.
4. **Prices are scaled by 1e18** (`PRICE_SCALE`). Unscaled per-token prices round to 0.
5. **No admin surface.** Do not add owner-only functions that move LP tokens, mint, or change fees on live launches. Token creation passes an empty `tokenKeys` array on purpose.
6. **State before interactions.** Every external entry point is `nonReentrant` and mutates storage before calling HTS, SaucerSwap or sending HBAR. Keep it that way.
7. **Secrets.** Never commit `.env`, `.env.local`, keystores or private keys. `HEDERA_OPERATOR_KEY` is server-only: never prefix it `NEXT_PUBLIC_` or read it in a client component.

## Hedera specifics to keep in mind

- **HTS from contracts** goes through the system contract at `0x167`. Token creation needs HBAR attached (`createFungibleToken{value: ...}`); the Launchpad forwards a $1.30 budget and refunds what HTS does not charge.
- **USD fees.** SaucerSwap's `pairCreateFee()` is in tinycents. Convert with `IExchangeRate(0x168).tinycentsToTinybars` at execution time; never hardcode HBAR amounts for fees.
- **Gas.** `createLaunch` uses ~7.4M gas, mostly SaucerSwap's `createPair`; HTS facade calls such as `approve` use ~730k. Hedera bills ≥ 80% of the gas limit, so do not pad limits generously. `eth_estimateGas` on Hashio simulates HTS correctly and is what the UI relies on.
- **Association.** A recipient must be associated or have free auto-association slots, otherwise HTS transfers revert. `useTokenAssociation` checks via the mirror node; `token.associate()` (HIP-719) fixes it.
- **ERC-20 facade.** HTS tokens answer `IERC20` calls at their own address, so use `SafeERC20` and `forceApprove` as usual.
- **Mirror node** log queries filtered by topic must cover ≤ 7 days; use `MirrorNodeClient.getLogs`, which windows and paginates. The mirror node lags consensus by a few seconds, so refetch after a short delay.
- **Long-zero addresses.** HTS tokens and most contracts have addresses like `0x000…00a53fc6`. `toEntityId()` converts them to `0.0.N` for HashScan and mirror-node URLs.

## Testing patterns

- **No protocol mocks.** Contract tests extend `ForkTestBase` and call `_forkHederaTestnet()` in `setUp()`. That forks testnet at `FORK_BLOCK`, installs the HTS emulator at `0x167` and the live exchange rate at `0x168`. SaucerSwap is the real deployment (router `0x…4b40`).
- Before touching a *pre-existing* HTS token in a test (WHBAR, USDC…), call `_useRealHtsToken(token)`, because Hashio returns EIP-7702 delegation code for tokens.
- If real protocol code calls an HTS function the emulator lacks (v1 ABI) or relies on contract keys, extend `HtsV1Compat` / `HtsContractKeyRouter` and check against the mirror node. Never stub the protocol.
- Fork tests need network access. Keep fuzz runs low on fork tests (`/// forge-config: default.fuzz.runs = 16`); pure maths goes in `BondingCurve.t.sol` with full fuzzing.
- `vm.prank` applies to the **next external call**, including view calls like `router.whbar()`. Cache addresses before pranking.
- Emulated HTS token creation requires `msg.value > 0`, just like the real network.
- Frontend logic belongs in `utils/launchpad/` as pure functions with Vitest coverage; hooks should stay thin.

## Adding features: where things go

- New contract behaviour: `Launchpad.sol` plus tests in `Launchpad.t.sol`. If it emits a new event, add it to `launchpadEvents` in `utils/launchpad/mirror.ts`.
- New on-chain read for the UI: `useScaffoldReadContract({ contractName: "Launchpad", functionName })`. It is typed from `deployedContracts.ts` after `yarn deploy`.
- New historical data: a `MirrorNodeClient` method plus a live test in `mirror.test.ts` against a real testnet launch.
- Another ecosystem protocol: add its addresses and ABI subset to `externalContracts.ts` and reference it by name in scaffold hooks.

## Debugging failed transactions

`https://testnet.mirrornode.hedera.com/api/v1/contracts/results/<txHash>/actions` returns the full call tree with gas per call and revert data. It is the fastest way to see whether HTS (`0x167`), the exchange rate (`0x168`) or SaucerSwap failed, and with which error. `INSUFFICIENT_GAS` inside SaucerSwap's `createPair` means the gas limit was too low.
