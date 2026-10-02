import { MAX_COMMENT_LENGTH, commentSigningMessage, decodeTopicComments, parseSignedComment } from "../comments";
import { verifyMessage } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const token = "0x0000000000000000000000000000000000A53fC6";
const now = 1_790_000_000;

async function signedComment(text = "gm") {
  const payload = { token, author: account.address, text, signedAt: now } as const;
  return { ...payload, signature: await account.signMessage({ message: commentSigningMessage(payload) }) };
}

const toTopicMessage = (body: unknown, sequence = 1) => ({
  message: btoa(JSON.stringify(body)),
  sequence_number: sequence,
  consensus_timestamp: `${now}.000000001`,
});

describe("comments", () => {
  it("produces signatures the relayer can verify", async () => {
    const comment = await signedComment();
    const parsed = parseSignedComment(comment, now);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    await expect(
      verifyMessage({
        address: account.address,
        message: commentSigningMessage(parsed.comment),
        signature: comment.signature,
      }),
    ).resolves.toBe(true);
  });

  it("detects tampered text", async () => {
    const comment = await signedComment();
    const tampered = { ...comment, text: "rug" };
    await expect(
      verifyMessage({
        address: account.address,
        message: commentSigningMessage(tampered),
        signature: comment.signature,
      }),
    ).resolves.toBe(false);
  });

  it("rejects expired, empty and oversized comments", async () => {
    const comment = await signedComment();
    expect(parseSignedComment(comment, now + 10 * 60)).toMatchObject({ ok: false });
    expect(parseSignedComment({ ...comment, text: "  " }, now)).toMatchObject({ ok: false });
    expect(parseSignedComment({ ...comment, text: "x".repeat(MAX_COMMENT_LENGTH + 1) }, now)).toMatchObject({
      ok: false,
    });
    expect(parseSignedComment(null)).toMatchObject({ ok: false });
  });

  it("decodes topic messages for one token and skips garbage", async () => {
    const mine = await signedComment("hello");
    const other = { ...(await signedComment("elsewhere")), token: "0x0000000000000000000000000000000000000001" };
    const comments = decodeTopicComments(
      [toTopicMessage(mine, 1), toTopicMessage(other, 2), { ...toTopicMessage(mine, 3), message: "!!notbase64" }],
      token,
    );
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ text: "hello", sequenceNumber: 1, consensusAt: now });
  });
});
