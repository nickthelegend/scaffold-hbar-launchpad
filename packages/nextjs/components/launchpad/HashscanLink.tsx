import { ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar";

type HashscanLinkProps = { path: `transaction/${string}` | `token/${string}` | `contract/${string}`; label: string };

/** Link to HashScan, Hedera's explorer, on the active network. */
export const HashscanLink = ({ path, label }: HashscanLinkProps) => {
  const { targetNetwork } = useTargetNetwork();
  const network = targetNetwork.id === 295 ? "mainnet" : "testnet";
  return (
    <a
      href={`https://hashscan.io/${network}/${path}`}
      target="_blank"
      rel="noreferrer"
      className="link link-hover inline-flex items-center gap-1"
    >
      {label}
      <ArrowTopRightOnSquareIcon className="h-3 w-3" />
    </a>
  );
};
