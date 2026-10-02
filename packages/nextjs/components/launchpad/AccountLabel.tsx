import type { Address } from "viem";
import { BlockieAvatar } from "~~/components/scaffold-hbar";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { hashscanUrl } from "~~/utils/launchpad/hashscan";

/** Compact avatar + short address linking to HashScan. Cheap enough for long lists (no account lookups). */
export const AccountLabel = ({ address }: { address: Address }) => {
  const { targetNetwork } = useTargetNetwork();
  return (
    <a
      href={hashscanUrl(targetNetwork.id, `account/${address}`)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 link link-hover text-sm"
    >
      <BlockieAvatar address={address} size={18} ensImage={null} />
      {`${address.slice(0, 6)}…${address.slice(-4)}`}
    </a>
  );
};
