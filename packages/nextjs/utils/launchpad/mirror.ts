import { type Address, type Hex, decodeEventLog, parseAbi, toEventSelector } from "viem";

/**
 * Thin client for the Hedera Mirror Node REST API, used as a free, hosted indexer:
 * launch metadata, trade history and pool prices are read from contract logs instead of a database.
 * Docs: https://docs.hedera.com/hedera/sdks-and-apis/rest-api
 */

export const MIRROR_NODE_URLS: Record<number, string> = {
  296: process.env.NEXT_PUBLIC_MIRROR_NODE_TESTNET_URL ?? "https://testnet.mirrornode.hedera.com",
  295: process.env.NEXT_PUBLIC_MIRROR_NODE_MAINNET_URL ?? "https://mainnet.mirrornode.hedera.com",
};

export const launchpadEvents = parseAbi([
  "event LaunchCreated(address indexed token, address indexed creator, address pair, string name, string symbol, string imageUri, string description)",
  "event Trade(address indexed token, address indexed trader, bool isBuy, uint256 hbarAmount, uint256 tokenAmount, uint256 fee, uint256 hbarRaised, uint256 tokensLeft)",
  "event Graduated(address indexed token, address indexed pair, uint256 hbarLiquidity, uint256 tokenLiquidity, uint256 lpTokens)",
]);

/** SaucerSwap V1 pairs emit Uniswap V2's `Sync` after every swap and liquidity change. */
export const pairEvents = parseAbi(["event Sync(uint112 reserve0, uint112 reserve1)"]);

const LAUNCH_CREATED_TOPIC = toEventSelector(launchpadEvents[0]);
const TRADE_TOPIC = toEventSelector(launchpadEvents[1]);
const GRADUATED_TOPIC = toEventSelector(launchpadEvents[2]);
const SYNC_TOPIC = toEventSelector(pairEvents[0]);

/** The mirror node rejects topic filters spanning more than 7 days. */
const MAX_TOPIC_WINDOW_SECONDS = 7 * 24 * 60 * 60;

type MirrorLog = {
  address: string;
  data: Hex;
  topics: Hex[];
  timestamp: string; // "seconds.nanoseconds"
  transaction_hash: Hex;
};

type MirrorLogsPage = { logs: MirrorLog[]; links?: { next: string | null } };

export type LaunchMetadata = {
  name: string;
  symbol: string;
  imageUri: string;
  description: string;
  creator: Address;
  pair: Address;
};

export type TradeEvent = {
  trader: Address;
  isBuy: boolean;
  hbarAmount: bigint;
  tokenAmount: bigint;
  fee: bigint;
  hbarRaised: bigint;
  tokensLeft: bigint;
  timestamp: number;
  transactionHash: Hex;
};

export type GraduationEvent = {
  hbarLiquidity: bigint;
  tokenLiquidity: bigint;
  timestamp: number;
  transactionHash: Hex;
};

export type PoolSync = { reserve0: bigint; reserve1: bigint; timestamp: number };

export class MirrorNodeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MirrorNodeError";
  }
}

export class MirrorNodeClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  static forChain(chainId: number): MirrorNodeClient {
    return new MirrorNodeClient(MIRROR_NODE_URLS[chainId] ?? MIRROR_NODE_URLS[296]);
  }

  async getLaunchMetadata(launchpad: Address, token: Address, createdAt: number): Promise<LaunchMetadata | null> {
    // `createdAt` is the consensus timestamp (seconds) of the launch, so a one-second window is exact.
    const logs = await this.getLogs(launchpad, {
      topic0: LAUNCH_CREATED_TOPIC,
      topic1: addressTopic(token),
      from: createdAt,
      to: createdAt + 1,
    });
    if (logs.length === 0) return null;
    const { args } = decodeEventLog({ abi: launchpadEvents, eventName: "LaunchCreated", ...toDecodable(logs[0]) });
    return {
      name: args.name,
      symbol: args.symbol,
      imageUri: args.imageUri,
      description: args.description,
      creator: args.creator,
      pair: args.pair,
    };
  }

  async getTrades(launchpad: Address, token: Address, since: number): Promise<TradeEvent[]> {
    const logs = await this.getLogs(launchpad, { topic0: TRADE_TOPIC, topic1: addressTopic(token), from: since });
    return logs.map(log => {
      const { args } = decodeEventLog({ abi: launchpadEvents, eventName: "Trade", ...toDecodable(log) });
      return {
        trader: args.trader,
        isBuy: args.isBuy,
        hbarAmount: args.hbarAmount,
        tokenAmount: args.tokenAmount,
        fee: args.fee,
        hbarRaised: args.hbarRaised,
        tokensLeft: args.tokensLeft,
        timestamp: parseTimestamp(log.timestamp),
        transactionHash: log.transaction_hash,
      };
    });
  }

  async getGraduation(launchpad: Address, token: Address, since: number): Promise<GraduationEvent | null> {
    const logs = await this.getLogs(launchpad, { topic0: GRADUATED_TOPIC, topic1: addressTopic(token), from: since });
    if (logs.length === 0) return null;
    const { args } = decodeEventLog({ abi: launchpadEvents, eventName: "Graduated", ...toDecodable(logs[0]) });
    return {
      hbarLiquidity: args.hbarLiquidity,
      tokenLiquidity: args.tokenLiquidity,
      timestamp: parseTimestamp(logs[0].timestamp),
      transactionHash: logs[0].transaction_hash,
    };
  }

  async getPoolSyncs(pair: Address, since: number): Promise<PoolSync[]> {
    const logs = await this.getLogs(pair, { topic0: SYNC_TOPIC, from: since });
    return logs.map(log => {
      const { args } = decodeEventLog({ abi: pairEvents, eventName: "Sync", ...toDecodable(log) });
      return { reserve0: args.reserve0, reserve1: args.reserve1, timestamp: parseTimestamp(log.timestamp) };
    });
  }

  /**
   * Whether `account` can receive `token` right now: either already associated, or it has
   * unlimited / free automatic association slots (HIP-904). Returns `null` if the account does not exist yet.
   */
  async getAssociationStatus(
    account: Address,
    token: Address,
  ): Promise<{ associated: boolean; autoAssociates: boolean } | null> {
    const accountRes = await this.get<{ max_automatic_token_associations: number } | null>(
      `/api/v1/accounts/${account}?transactions=false`,
      { allowNotFound: true },
    );
    if (!accountRes) return null;
    const relationships = await this.get<{ tokens: { token_id: string }[] }>(
      `/api/v1/accounts/${account}/tokens?token.id=${toEntityId(token)}`,
    );
    return {
      associated: relationships.tokens.length > 0,
      autoAssociates: accountRes.max_automatic_token_associations !== 0,
    };
  }

  /** Fetches logs, splitting the range into 7-day windows when filtering by topic, and following pagination. */
  async getLogs(
    contract: Address,
    filter: { topic0: Hex; topic1?: Hex; from: number; to?: number },
  ): Promise<MirrorLog[]> {
    const end = filter.to ?? Math.ceil(Date.now() / 1000);
    const logs: MirrorLog[] = [];
    for (let start = filter.from; start <= end; start += MAX_TOPIC_WINDOW_SECONDS) {
      const windowEnd = Math.min(start + MAX_TOPIC_WINDOW_SECONDS - 1, end);
      const params = new URLSearchParams({ topic0: filter.topic0, order: "asc", limit: "100" });
      if (filter.topic1) params.set("topic1", filter.topic1);
      params.append("timestamp", `gte:${start}`);
      params.append("timestamp", `lte:${windowEnd}.999999999`);

      let path: string | null = `/api/v1/contracts/${contract}/results/logs?${params}`;
      while (path) {
        const page: MirrorLogsPage = await this.get<MirrorLogsPage>(path);
        logs.push(...page.logs);
        path = page.links?.next ?? null;
      }
    }
    return logs;
  }

  private async get<T>(path: string, options: { allowNotFound?: boolean } = {}): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { headers: { Accept: "application/json" } });
    if (res.status === 404 && options.allowNotFound) return null as T;
    if (!res.ok) throw new MirrorNodeError(`Mirror node request failed: ${res.status} ${path}`, res.status);
    return (await res.json()) as T;
  }
}

/** Left-pads an address into a 32-byte log topic. */
export function addressTopic(address: Address): Hex {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}

/** Converts a long-zero EVM address (e.g. HTS tokens) into its `0.0.N` entity id. */
export function toEntityId(address: Address): string {
  return `0.0.${BigInt(address).toString()}`;
}

function parseTimestamp(consensusTimestamp: string): number {
  return Number(consensusTimestamp.split(".")[0]);
}

function toDecodable(log: MirrorLog) {
  return { data: log.data, topics: log.topics as [Hex, ...Hex[]] };
}
