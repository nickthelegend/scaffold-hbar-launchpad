/**
 * End-to-end walkthrough against a deployed Launchpad on Hedera testnet:
 *   1. create a launch (HTS token + SaucerSwap pair)
 *   2. buy on the bonding curve
 *   3. approve + sell part of it back
 *   4. with --graduate: buy until the curve closes and liquidity moves to SaucerSwap, then swap on SaucerSwap
 * Every step prints a HashScan link, which doubles as proof the integration works on a live network.
 *
 * Usage:
 *   yarn foundry:demo                  # keystore picker, launch + buy + sell
 *   yarn foundry:demo --graduate       # also graduate (needs ~threshold HBAR extra)
 *   DEMO_PRIVATE_KEY=0x... yarn foundry:demo   # non-interactive (CI)
 */
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { ethers } from "ethers";
import { listKeystores } from "./listKeystores.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RPC_URL = process.env.HEDERA_RPC_URL || "https://testnet.hashio.io/api";
const HASHSCAN = "https://hashscan.io/testnet";
const WEIBARS_PER_TINYBAR = ethers.BigNumber.from(10).pow(10);
const GAS_HEADROOM_PERCENT = 105;

const LAUNCHPAD_ABI = [
  "function createLaunch(string,string,string,string) payable returns (address)",
  "function buy(address token, uint256 minTokensOut) payable returns (uint256)",
  "function sell(address token, uint256 tokenAmount, uint256 minHbarOut) returns (uint256)",
  "function quoteLaunchCost() view returns (uint256)",
  "function quoteBuy(address token, uint256 hbarValue) view returns (uint256 tokensOut, uint256 fee, uint256 refund)",
  "function graduationThreshold() view returns (uint256)",
  "function router() view returns (address)",
  "function whbar() view returns (address)",
  "function getLaunch(address) view returns (tuple(address creator, address pair, address lpToken, uint64 createdAt, bool graduated, uint256 hbarRaised, uint256 tokensLeft))",
  "event LaunchCreated(address indexed token, address indexed creator, address pair, string name, string symbol, string imageUri, string description)",
];
const TOKEN_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];
const ROUTER_ABI = [
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[])",
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])",
];

const tinybars = (hbar) => ethers.utils.parseUnits(String(hbar), 8);
const toWeibars = (tinybarAmount) =>
  ethers.BigNumber.from(tinybarAmount).mul(WEIBARS_PER_TINYBAR);
const formatHbar = (tinybarAmount) =>
  ethers.utils.formatUnits(tinybarAmount, 8);
const toEntityId = (address) =>
  `0.0.${ethers.BigNumber.from(address).toString()}`;

async function loadSigner(provider) {
  if (process.env.DEMO_PRIVATE_KEY)
    return new ethers.Wallet(process.env.DEMO_PRIVATE_KEY, provider);
  const keystore = await listKeystores(
    "Select the keystore to run the demo with (enter the number): "
  );
  if (!keystore) throw new Error("No keystore selected");
  const output = execSync(`cast wallet decrypt-keystore ${keystore}`, {
    stdio: ["inherit", "pipe", "inherit"],
  })
    .toString()
    .trim();
  const privateKey = output.match(/0x[0-9a-fA-F]{64}/)?.[0];
  if (!privateKey) throw new Error("Could not decrypt keystore");
  return new ethers.Wallet(privateKey, provider);
}

/** Your own deployment (deployments/296.json) if present, otherwise the shared one baked into the frontend. */
function loadLaunchpadAddress() {
  if (process.env.LAUNCHPAD_ADDRESS) return process.env.LAUNCHPAD_ADDRESS;
  const deploymentsPath = join(__dirname, "..", "deployments", "296.json");
  if (existsSync(deploymentsPath)) {
    const deployments = JSON.parse(readFileSync(deploymentsPath, "utf8"));
    const address = Object.keys(deployments).find(
      (key) => deployments[key] === "Launchpad"
    );
    if (address) return address;
  }
  const generated = readFileSync(
    join(__dirname, "..", "..", "nextjs", "contracts", "deployedContracts.ts"),
    "utf8"
  );
  const shared = generated.match(
    /296:\s*{\s*Launchpad:\s*{\s*address:\s*"(0x[0-9a-fA-F]{40})"/
  );
  if (!shared)
    throw new Error(
      "No Launchpad found — run `yarn deploy --network hedera_testnet`"
    );
  return shared[1];
}

const MAX_GAS = ethers.BigNumber.from(15_000_000); // Hedera's per-transaction gas limit

/**
 * Sends a tx with an estimated gas limit (+5%). Hedera bills at least 80% of the limit, and the relay rejects a tx
 * whose value + limit × price exceeds the balance, so the limit is also capped at what the signer can afford.
 */
async function send(label, contract, method, args, overrides = {}) {
  const [balance, gasPrice] = await Promise.all([
    contract.signer.getBalance(),
    contract.provider.getGasPrice(),
  ]);
  // The relay checks the balance with a small gas-price buffer, so leave 5% spare.
  const affordable = balance
    .sub(overrides.value ?? 0)
    .div(gasPrice)
    .mul(95)
    .div(100);
  const cap = affordable.lt(MAX_GAS) ? affordable : MAX_GAS;
  const estimate = await contract.estimateGas[method](...args, overrides);
  const padded = estimate.mul(GAS_HEADROOM_PERCENT).div(100);
  const tx = await contract[method](...args, {
    ...overrides,
    gasPrice,
    gasLimit: padded.lt(cap) ? padded : cap,
  });
  const receipt = await tx.wait();
  console.log(
    `  ✔ ${label}\n    ${HASHSCAN}/transaction/${receipt.transactionHash}`
  );
  return receipt;
}

async function main() {
  const graduate = process.argv.includes("--graduate");
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const signer = await loadSigner(provider);
  const launchpad = new ethers.Contract(
    loadLaunchpadAddress(),
    LAUNCHPAD_ABI,
    signer
  );

  const balance = await provider.getBalance(signer.address);
  const threshold = await launchpad.graduationThreshold();
  const launchCost = await launchpad.quoteLaunchCost();
  console.log(
    `\nLaunchpad ${launchpad.address}\nSigner    ${
      signer.address
    } (${ethers.utils.formatEther(balance)} HBAR)`
  );
  console.log(
    `Launch cost ${formatHbar(
      launchCost
    )} HBAR (refund of unused HTS budget expected), graduation at ${formatHbar(
      threshold
    )} HBAR\n`
  );

  console.log("1. Launch");
  const receipt = await send(
    "createLaunch",
    launchpad,
    "createLaunch",
    [
      "Scaffold Demo",
      "DEMO",
      "",
      "Created by `yarn foundry:demo` in the scaffold-hbar launchpad template.",
    ],
    { value: toWeibars(launchCost) }
  );
  const created = receipt.logs
    .map((log) => {
      try {
        return launchpad.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((event) => event?.name === "LaunchCreated");
  if (!created)
    throw new Error(
      "createLaunch succeeded but emitted no LaunchCreated event"
    );
  const token = created.args.token;
  console.log(
    `    token ${toEntityId(token)} → ${HASHSCAN}/token/${toEntityId(token)}`
  );
  console.log(`    SaucerSwap pair ${created.args.pair}`);

  console.log("\n2. Buy on the curve");
  const buyValue = tinybars(1);
  const [quotedOut] = await launchpad.quoteBuy(token, buyValue);
  await send(
    `buy 1 HBAR → ${ethers.utils.formatUnits(quotedOut, 8)} DEMO`,
    launchpad,
    "buy",
    [token, quotedOut.mul(99).div(100)],
    {
      value: toWeibars(buyValue),
    }
  );

  console.log("\n3. Sell half back");
  const tokenContract = new ethers.Contract(token, TOKEN_ABI, signer);
  const half = (await tokenContract.balanceOf(signer.address)).div(2);
  await send("approve launchpad (HTS allowance)", tokenContract, "approve", [
    launchpad.address,
    half,
  ]);
  await send(
    `sell ${ethers.utils.formatUnits(half, 8)} DEMO`,
    launchpad,
    "sell",
    [token, half, 0]
  );

  if (graduate) {
    console.log("\n4. Graduate into SaucerSwap");
    const { hbarRaised } = await launchpad.getLaunch(token);
    // Overshoot slightly; the contract only spends what the curve needs and refunds the rest.
    const value = threshold.sub(hbarRaised).mul(102).div(100);
    await send(
      `buy ${formatHbar(value)} HBAR (crosses the threshold)`,
      launchpad,
      "buy",
      [token, 0],
      { value: toWeibars(value) }
    );
    const launch = await launchpad.getLaunch(token);
    console.log(
      `    graduated=${launch.graduated}, LP token ${toEntityId(
        launch.lpToken
      )} locked in the launchpad`
    );

    console.log("\n5. Swap on SaucerSwap");
    const router = new ethers.Contract(
      await launchpad.router(),
      ROUTER_ABI,
      signer
    );
    const path = [await launchpad.whbar(), token];
    const swapIn = tinybars(0.5);
    const [, out] = await router.getAmountsOut(swapIn, path);
    const deadline = Math.floor(Date.now() / 1000) + 300;
    await send(
      `swap 0.5 HBAR → ${ethers.utils.formatUnits(out, 8)} DEMO via SaucerSwap`,
      router,
      "swapExactETHForTokens",
      [out.mul(99).div(100), path, signer.address, deadline],
      { value: toWeibars(swapIn) }
    );
  }

  console.log(`\nDone. Open the app at /token/${token}\n`);
}

main().catch((error) => {
  console.error("\n❌", error.reason ?? error.message ?? error);
  if (process.env.DEBUG) console.error(error);
  process.exit(1);
});
