/** Hedera network name for a chain id (295 mainnet, otherwise testnet). */
export function hederaNetwork(chainId: number): "mainnet" | "testnet" {
  return chainId === 295 ? "mainnet" : "testnet";
}

/** HashScan URL for an entity on the given chain, e.g. `hashscanUrl(296, "token/0.0.123")`. */
export function hashscanUrl(chainId: number, path: string): string {
  return `https://hashscan.io/${hederaNetwork(chainId)}/${path}`;
}
