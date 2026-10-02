import { ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { hashscanUrl } from "~~/utils/launchpad/hashscan";

type HashscanLinkProps = {
  path: `transaction/${string}` | `token/${string}` | `contract/${string}` | `topic/${string}`;
  label: string;
};

/** Link to HashScan, Hedera's explorer, on the active network. */
export const HashscanLink = ({ path, label }: HashscanLinkProps) => {
  const { targetNetwork } = useTargetNetwork();
  return (
    <a
      href={hashscanUrl(targetNetwork.id, path)}
      target="_blank"
      rel="noreferrer"
      className="link link-hover inline-flex items-center gap-1"
    >
      {label}
      <ArrowTopRightOnSquareIcon className="h-3 w-3" />
    </a>
  );
};
