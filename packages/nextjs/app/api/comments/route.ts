import { NextResponse } from "next/server";
import { AccountId, Client, PrivateKey, TopicId, TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";
import { SIGNATURE_TTL_SECONDS, isAuthentic, parseSignedComment } from "~~/utils/launchpad/comments";

/**
 * Signatures relayed recently, so a comment copied from the public topic cannot be resubmitted (each submission
 * costs the operator HBAR). Entries older than the signature TTL can be dropped: `parseSignedComment` rejects them.
 * In-memory per server instance; use a shared store (e.g. Redis) if you run several replicas.
 */
const relayed = new Map<string, number>();

function markRelayed(signature: string, now: number): boolean {
  for (const [seen, at] of relayed) if (now - at > SIGNATURE_TTL_SECONDS) relayed.delete(seen);
  if (relayed.has(signature)) return false;
  relayed.set(signature, now);
  return true;
}

/**
 * Relays wallet-signed comments to the HCS topic in NEXT_PUBLIC_HCS_TOPIC_ID.
 * Requires HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY (server-only) to pay the HCS fee; the operator
 * key must be the topic's submit key (see `yarn hcs:create-topic`).
 */
export async function POST(req: Request) {
  const topicId = process.env.NEXT_PUBLIC_HCS_TOPIC_ID;
  const operatorId = process.env.HEDERA_OPERATOR_ID;
  const operatorKey = process.env.HEDERA_OPERATOR_KEY;
  if (!topicId || !operatorId || !operatorKey) {
    return NextResponse.json({ error: "Comments are not configured on this deployment" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  const parsed = parseSignedComment(body, now);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { comment } = parsed;

  if (!(await isAuthentic(comment))) {
    return NextResponse.json({ error: "Signature does not match author" }, { status: 401 });
  }
  if (!markRelayed(comment.signature, now)) {
    return NextResponse.json({ error: "This comment was already submitted" }, { status: 409 });
  }

  const client = hederaClient(operatorId, operatorKey);
  try {
    const response = await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(topicId))
      .setMessage(JSON.stringify(comment))
      .execute(client);
    const receipt = await response.getReceipt(client);
    return NextResponse.json({
      sequenceNumber: receipt.topicSequenceNumber?.toString(),
      transactionId: response.transactionId.toString(),
    });
  } catch (error) {
    console.error("[api/comments] HCS submit failed", error);
    return NextResponse.json({ error: "Failed to submit to HCS" }, { status: 502 });
  } finally {
    client.close();
  }
}

function hederaClient(operatorId: string, operatorKey: string): Client {
  const client = process.env.NEXT_PUBLIC_HEDERA_NETWORK === "mainnet" ? Client.forMainnet() : Client.forTestnet();
  return client.setOperator(AccountId.fromString(operatorId), PrivateKey.fromStringECDSA(operatorKey));
}
