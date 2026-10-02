import { NextResponse } from "next/server";
import { AccountId, Client, PrivateKey, TopicId, TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";
import { verifyMessage } from "viem";
import { commentSigningMessage, parseSignedComment } from "~~/utils/launchpad/comments";

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

  const parsed = parseSignedComment(body, Math.floor(Date.now() / 1000));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { comment } = parsed;

  const validSignature = await verifyMessage({
    address: comment.author,
    message: commentSigningMessage(comment),
    signature: comment.signature,
  }).catch(() => false);
  if (!validSignature) return NextResponse.json({ error: "Signature does not match author" }, { status: 401 });

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
