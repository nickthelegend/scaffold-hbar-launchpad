"use client";

import { useState } from "react";
import { AccountLabel } from "./AccountLabel";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import { useComments } from "~~/hooks/launchpad/useComments";
import { MAX_COMMENT_LENGTH } from "~~/utils/launchpad/comments";
import { notification } from "~~/utils/scaffold-hbar";

/** Comment thread stored on Hedera Consensus Service; each comment carries its author's wallet signature. */
export const CommentsThread = ({ token }: { token: Address }) => {
  const { address } = useAccount();
  const { comments, post, enabled } = useComments(token);
  const [text, setText] = useState("");

  if (!enabled) {
    return (
      <div className="bg-base-100 rounded-2xl border border-base-300 p-4 text-sm text-base-content/60">
        Comments are stored on HCS. Set <code>NEXT_PUBLIC_HCS_TOPIC_ID</code> (see README) to enable them.
      </div>
    );
  }

  const submit = async () => {
    try {
      await post.mutateAsync(text);
      setText("");
      notification.success("Comment submitted to HCS");
    } catch (error) {
      notification.error(error instanceof Error ? error.message : "Failed to post comment");
    }
  };

  return (
    <div className="bg-base-100 rounded-2xl border border-base-300 p-4 flex flex-col gap-3">
      <div className="flex justify-between items-baseline">
        <h3 className="font-bold m-0">Thread</h3>
        <span className="text-xs text-base-content/50">
          signed comments on HCS topic {process.env.NEXT_PUBLIC_HCS_TOPIC_ID}
        </span>
      </div>
      <div className="flex gap-2">
        <input
          className="input input-bordered input-sm flex-1"
          placeholder={address ? "Say something…" : "Connect a wallet to comment"}
          maxLength={MAX_COMMENT_LENGTH}
          value={text}
          disabled={!address}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === "Enter" && text.trim() && submit()}
        />
        <button
          className="btn btn-primary btn-sm"
          disabled={!address || !text.trim() || post.isPending}
          onClick={submit}
        >
          {post.isPending ? <span className="loading loading-spinner loading-xs" /> : "Post"}
        </button>
      </div>
      {comments.isLoading && <span className="loading loading-dots loading-sm" />}
      {comments.data?.length === 0 && <p className="text-sm text-base-content/50 m-0">No comments yet.</p>}
      <ul className="flex flex-col gap-3 m-0 p-0 list-none">
        {comments.data?.map(comment => (
          <li key={comment.sequenceNumber} className="border-t border-base-300 pt-3">
            <div className="flex items-center justify-between gap-2">
              <AccountLabel address={comment.author} />
              <span className="text-xs text-base-content/50">
                #{comment.sequenceNumber} · {new Date(comment.consensusAt * 1000).toLocaleString()}
              </span>
            </div>
            <p className="text-sm m-0 mt-1 break-words">{comment.text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
};
