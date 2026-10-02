/**
 * Creates the HCS topic that stores token comments, with the operator key as submit key so only the
 * `/api/comments` relayer (which verifies wallet signatures) can post to it.
 *
 * Usage: yarn hcs:create-topic   (reads HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY from .env.local)
 */
import { AccountId, Client, PrivateKey, TopicCreateTransaction } from "@hiero-ledger/sdk";
import { config } from "dotenv";

config({ path: ".env.local" });

const { HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, NEXT_PUBLIC_HEDERA_NETWORK } = process.env;
if (!HEDERA_OPERATOR_ID || !HEDERA_OPERATOR_KEY) {
  console.error("Set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY in packages/nextjs/.env.local first.");
  process.exit(1);
}

const operatorKey = PrivateKey.fromStringECDSA(HEDERA_OPERATOR_KEY);
const client = NEXT_PUBLIC_HEDERA_NETWORK === "mainnet" ? Client.forMainnet() : Client.forTestnet();
client.setOperator(AccountId.fromString(HEDERA_OPERATOR_ID), operatorKey);

try {
  const response = await new TopicCreateTransaction()
    .setTopicMemo("Hedera Launchpad token comments")
    .setSubmitKey(operatorKey.publicKey)
    .execute(client);
  const { topicId } = await response.getReceipt(client);
  console.log(`Created topic ${topicId}. Add this to packages/nextjs/.env.local:\n`);
  console.log(`NEXT_PUBLIC_HCS_TOPIC_ID=${topicId}`);
} finally {
  client.close();
}
