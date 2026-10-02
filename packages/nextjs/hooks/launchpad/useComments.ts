import { useLaunchpad } from "./useLaunchpad";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { useAccount, useSignMessage } from "wagmi";
import { commentSigningMessage, decodeTopicComments } from "~~/utils/launchpad/comments";
import { MIRROR_NODE_URLS } from "~~/utils/launchpad/mirror";

const TOPIC_ID = process.env.NEXT_PUBLIC_HCS_TOPIC_ID;

/** Reads a token's comment thread from HCS (via the mirror node) and posts wallet-signed comments. */
export function useComments(token: Address) {
  const { chainId } = useLaunchpad();
  const { address: author } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const queryClient = useQueryClient();
  const queryKey = ["comments", chainId, TOPIC_ID, token];

  const comments = useQuery({
    queryKey,
    enabled: Boolean(TOPIC_ID),
    refetchInterval: 10_000,
    queryFn: async () => {
      const res = await fetch(`${MIRROR_NODE_URLS[chainId]}/api/v1/topics/${TOPIC_ID}/messages?order=desc&limit=100`);
      if (!res.ok) throw new Error(`Mirror node returned ${res.status}`);
      const { messages } = await res.json();
      return decodeTopicComments(messages, token);
    },
  });

  const post = useMutation({
    mutationFn: async (text: string) => {
      if (!author) throw new Error("Connect a wallet to comment");
      const payload = { token, author, text, signedAt: Math.floor(Date.now() / 1000) };
      const signature = await signMessageAsync({ message: commentSigningMessage(payload) });
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, signature }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to post comment");
      return body as { sequenceNumber: string };
    },
    // Give the mirror node a moment to ingest the new message.
    onSuccess: () => setTimeout(() => queryClient.invalidateQueries({ queryKey }), 4_000),
  });

  return { comments, post, enabled: Boolean(TOPIC_ID) };
}
