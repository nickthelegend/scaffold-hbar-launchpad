import { toPricePoints } from "../activity";
import { LIQUIDITY_SUPPLY } from "../curve";
import { MirrorNodeClient, addressTopic, toEntityId } from "../mirror";
import type { Address } from "viem";
import { describe, expect, it } from "vitest";

/**
 * Integration tests against the live Hedera testnet mirror node. The first suite uses the original showcase launch
 * (a single-buy graduation on a 1 HBAR Launchpad), whose exact amounts are known; the second uses the multi-wallet
 * HCAT on the current shared Launchpad. See README → Testnet proof.
 */
const mirror = new MirrorNodeClient("https://testnet.mirrornode.hedera.com");
const LAUNCHPAD = "0x1390Ee0F0A81fE4A262aA0970d83186AFCb50bA3" as Address;
const HCAT = "0x0000000000000000000000000000000000a54575" as Address;
const HCAT_PAIR = "0xb1601a6Ce4Df207C8a61CBc1fB527BD2d96031B1" as Address;
const WHBAR = "0x0000000000000000000000000000000000003aD2" as Address;
const CREATOR = "0xE243BcCd0a84542D8AD4263833C0c594FCCee705" as Address;
const CREATED_AT = 1_790_973_074; // Launchpad.getLaunch(HCAT).createdAt
const THRESHOLD = 100_000_000n; // 1 HBAR on the shared deployment

describe("MirrorNodeClient (live testnet)", { timeout: 30_000 }, () => {
  it("reads launch metadata from the LaunchCreated event", async () => {
    const metadata = await mirror.getLaunchMetadata(LAUNCHPAD, HCAT, CREATED_AT);
    expect(metadata).toMatchObject({ name: "Hedera Cat", symbol: "HCAT", creator: CREATOR });
    expect(metadata?.pair.toLowerCase()).toBe(HCAT_PAIR.toLowerCase());
    expect(metadata?.imageUri).toMatch(/^https:\/\//);
  });

  it("returns null for a window with no launch", async () => {
    await expect(mirror.getLaunchMetadata(LAUNCHPAD, HCAT, CREATED_AT - 3_600)).resolves.toBeNull();
  });

  it("decodes curve trades, including the graduating buy", async () => {
    const trades = await mirror.getTrades(LAUNCHPAD, HCAT, CREATED_AT);
    expect(trades.length).toBeGreaterThanOrEqual(1);
    const [first] = trades;
    expect(first).toMatchObject({ isBuy: true, hbarAmount: THRESHOLD, hbarRaised: THRESHOLD, tokensLeft: 0n });
    expect(first.trader.toLowerCase()).toBe(CREATOR.toLowerCase());
    expect(first.transactionHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("finds the graduation and the SaucerSwap pool's Sync history", async () => {
    const graduation = await mirror.getGraduation(LAUNCHPAD, HCAT, CREATED_AT);
    expect(graduation).toMatchObject({ hbarLiquidity: THRESHOLD });
    expect(graduation!.tokenLiquidity).toBeGreaterThanOrEqual(LIQUIDITY_SUPPLY);

    const syncs = await mirror.getPoolSyncs(HCAT_PAIR, graduation!.timestamp);
    // One Sync from seeding liquidity, one per swap afterwards.
    expect(syncs.length).toBeGreaterThanOrEqual(2);

    const trades = await mirror.getTrades(LAUNCHPAD, HCAT, CREATED_AT);
    const points = toPricePoints(THRESHOLD, trades, syncs, HCAT, WHBAR);
    const [curveEnd, poolOpen] = points;
    // The curve's last price and the pool's opening price agree: no jump at graduation.
    expect(poolOpen.price / curveEnd.price).toBeCloseTo(1, 6);
  });

  it("reports association state for accounts", async () => {
    // The creator holds HCAT, so it is associated (and wallet-created accounts auto-associate anyway).
    await expect(mirror.getAssociationStatus(CREATOR, HCAT)).resolves.toMatchObject({ associated: true });
    // A random address that never touched Hedera has no account yet.
    await expect(mirror.getAssociationStatus("0x7a3f9e2b8c1d4e5f60718293a4b5c6d7e8f90a1b", HCAT)).resolves.toBeNull();
  });

  it("splits topic queries into 7-day windows", async () => {
    // A range spanning > 7 days must not trip the mirror node's topic-window limit.
    const trades = await mirror.getTrades(LAUNCHPAD, HCAT, CREATED_AT - 20 * 86_400);
    expect(trades.length).toBeGreaterThanOrEqual(1);
  });
});

describe("MirrorNodeClient on the current shared Launchpad (live testnet)", { timeout: 60_000 }, () => {
  const SHARED_LAUNCHPAD = "0x04085b490EBB91B8A3B80a32D8D7dcF9B2c12502" as Address;
  const HCAT_V2 = "0x0000000000000000000000000000000000a578b0" as Address;
  const HCAT_V2_PAIR = "0x8b4Bb3EC17EEd067eDc41E641148823c0795C7b9" as Address;
  const HCAT_V2_CREATED_AT = 1_791_044_091;

  it("decodes a multi-wallet curve history: buys, sells, then graduation", async () => {
    const trades = await mirror.getTrades(SHARED_LAUNCHPAD, HCAT_V2, HCAT_V2_CREATED_AT);
    // alice, bob, carol buy; alice sells half; alice's buy graduates.
    expect(trades.length).toBeGreaterThanOrEqual(5);
    expect(new Set(trades.map(t => t.trader.toLowerCase())).size).toBeGreaterThanOrEqual(3);
    expect(trades.some(t => !t.isBuy)).toBe(true);
    // The graduating buy fills the curve to exactly 25 HBAR; any rounding dust left on it joins the pool.
    expect(trades.at(-1)).toMatchObject({ isBuy: true, hbarRaised: 2_500_000_000n });

    const graduation = await mirror.getGraduation(SHARED_LAUNCHPAD, HCAT_V2, HCAT_V2_CREATED_AT);
    expect(graduation).not.toBeNull();
    // Seeding, then a SaucerSwap buy and a SaucerSwap sell.
    const syncs = await mirror.getPoolSyncs(HCAT_V2_PAIR, graduation!.timestamp);
    expect(syncs.length).toBeGreaterThanOrEqual(3);
  });
});

describe("helpers", () => {
  it("maps long-zero addresses to entity ids", () => {
    expect(toEntityId(HCAT)).toBe("0.0.10831221");
  });

  it("pads addresses into log topics", () => {
    expect(addressTopic(HCAT)).toBe(`0x${"0".repeat(58)}a54575`);
  });
});
