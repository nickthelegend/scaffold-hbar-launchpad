import { type Address, type Hex, getAddress, isAddress, isHex } from "viem";

/**
 * Token comment threads live on a Hedera Consensus Service (HCS) topic.
 *
 * Wallets cannot sign HCS transactions directly (they sign EVM transactions), so each comment is
 * signed off-chain with `personal_sign` and relayed by `/api/comments`, which pays the HCS fee.
 * The topic's submit key belongs to the relayer, but every message embeds the author's signature,
 * so anyone reading the topic from the mirror node can verify who wrote what — the relayer can
 * delay a comment, but never forge or alter one.
 */

export const MAX_COMMENT_LENGTH = 280;
/** Signed comments older than this are rejected, so a captured signature cannot be replayed later. */
export const SIGNATURE_TTL_SECONDS = 5 * 60;

export type CommentPayload = {
  token: Address;
  author: Address;
  text: string;
  /** Unix seconds at signing time. */
  signedAt: number;
};

export type SignedComment = CommentPayload & { signature: Hex };

export type TopicComment = SignedComment & {
  sequenceNumber: number;
  /** Consensus timestamp, unix seconds. */
  consensusAt: number;
};

/** The exact text the author signs. Human-readable so wallets show what is being signed. */
export function commentSigningMessage({ token, author, text, signedAt }: CommentPayload): string {
  return [
    "Hedera Launchpad comment",
    `Token: ${getAddress(token)}`,
    `Author: ${getAddress(author)}`,
    `Signed at: ${signedAt}`,
    "",
    text,
  ].join("\n");
}

export type ValidationResult = { ok: true; comment: SignedComment } | { ok: false; error: string };

/** Validates untrusted input (request bodies, topic messages) into a `SignedComment`. */
export function parseSignedComment(input: unknown, nowSeconds?: number): ValidationResult {
  if (typeof input !== "object" || input === null) return { ok: false, error: "Body must be an object" };
  const { token, author, text, signedAt, signature } = input as Record<string, unknown>;

  if (typeof token !== "string" || !isAddress(token, { strict: false }))
    return { ok: false, error: "Invalid token address" };
  if (typeof author !== "string" || !isAddress(author, { strict: false }))
    return { ok: false, error: "Invalid author address" };
  if (typeof text !== "string" || text.trim().length === 0) return { ok: false, error: "Comment is empty" };
  if (text.length > MAX_COMMENT_LENGTH) return { ok: false, error: `Max ${MAX_COMMENT_LENGTH} characters` };
  if (typeof signedAt !== "number" || !Number.isInteger(signedAt)) return { ok: false, error: "Invalid signedAt" };
  if (typeof signature !== "string" || !isHex(signature)) return { ok: false, error: "Invalid signature" };
  if (nowSeconds !== undefined && Math.abs(nowSeconds - signedAt) > SIGNATURE_TTL_SECONDS) {
    return { ok: false, error: "Signature expired, please sign again" };
  }

  return {
    ok: true,
    comment: { token: getAddress(token), author: getAddress(author), text: text.trim(), signedAt, signature },
  };
}

type MirrorTopicMessage = { message: string; sequence_number: number; consensus_timestamp: string };

/** Decodes mirror node topic messages (base64 JSON), dropping anything malformed or for other tokens. */
export function decodeTopicComments(messages: MirrorTopicMessage[], token: Address): TopicComment[] {
  const wanted = getAddress(token);
  const comments: TopicComment[] = [];
  for (const message of messages) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(decodeBase64Utf8(message.message));
    } catch {
      continue;
    }
    const parsed = parseSignedComment(decoded);
    if (!parsed.ok || parsed.comment.token !== wanted) continue;
    comments.push({
      ...parsed.comment,
      sequenceNumber: message.sequence_number,
      consensusAt: Number(message.consensus_timestamp.split(".")[0]),
    });
  }
  return comments;
}

/** Base64 → UTF-8 that works in both the browser and Node (no `Buffer`). */
function decodeBase64Utf8(base64: string): string {
  const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
