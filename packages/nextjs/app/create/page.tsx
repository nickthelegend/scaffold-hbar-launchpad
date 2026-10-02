"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { NextPage } from "next";
import { decodeEventLog } from "viem";
import { useAccount } from "wagmi";
import { TokenAvatar } from "~~/components/launchpad/TokenAvatar";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-hbar";
import { launchpadEvents } from "~~/utils/launchpad/mirror";
import { formatHbar, tinybarsToWeibars } from "~~/utils/launchpad/units";

const LIMITS = { name: 64, symbol: 16, imageUri: 256, description: 512 } as const;

const CreatePage: NextPage = () => {
  const router = useRouter();
  const { address } = useAccount();
  const [form, setForm] = useState({ name: "", symbol: "", imageUri: "", description: "" });
  const { data: launchCost } = useScaffoldReadContract({ contractName: "Launchpad", functionName: "quoteLaunchCost" });
  const { writeContractAsync, isMining } = useScaffoldWriteContract({ contractName: "Launchpad" });

  const update = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [field]: field === "symbol" ? e.target.value.toUpperCase() : e.target.value }));

  const canSubmit = Boolean(address && form.name.trim() && form.symbol.trim() && launchCost && !isMining);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!launchCost) return;
    await writeContractAsync(
      {
        functionName: "createLaunch",
        args: [form.name.trim(), form.symbol.trim(), form.imageUri.trim(), form.description.trim()],
        // Small buffer in case the HBAR/USD rate moves before consensus; the contract refunds the excess.
        value: tinybarsToWeibars((launchCost * 105n) / 100n),
      },
      {
        onBlockConfirmation: receipt => {
          for (const log of receipt.logs) {
            try {
              const event = decodeEventLog({ abi: launchpadEvents, data: log.data, topics: log.topics });
              if (event.eventName === "LaunchCreated") return router.push(`/token/${event.args.token}`);
            } catch {
              // Not a launchpad event (e.g. SaucerSwap's PairCreated).
            }
          }
        },
      },
    );
  };

  return (
    <div className="max-w-xl w-full mx-auto px-5 py-10">
      <h1 className="text-3xl font-bold m-0">Launch a token</h1>
      <p className="text-base-content/70 mt-2">
        Creates a fixed supply of 1,000,000,000 HTS tokens with no admin, supply, freeze or wipe keys, and its
        SaucerSwap pool. Nobody, including you, gets tokens for free: buy on the curve like everyone else.
      </p>

      <form onSubmit={submit} className="bg-base-100 rounded-2xl border border-base-300 p-6 flex flex-col gap-4 mt-6">
        <div className="flex gap-4 items-center">
          <TokenAvatar imageUri={form.imageUri} symbol={form.symbol} size={64} />
          <div className="flex-1 grid grid-cols-3 gap-3">
            <Field label="Name" className="col-span-2">
              <input
                className="input input-bordered w-full"
                maxLength={LIMITS.name}
                value={form.name}
                onChange={update("name")}
                placeholder="Hashgraph Cat"
                required
              />
            </Field>
            <Field label="Symbol">
              <input
                className="input input-bordered w-full"
                maxLength={LIMITS.symbol}
                value={form.symbol}
                onChange={update("symbol")}
                placeholder="HCAT"
                required
              />
            </Field>
          </div>
        </div>
        <Field label="Image URL (https:// or ipfs://, optional)">
          <input
            className="input input-bordered w-full"
            maxLength={LIMITS.imageUri}
            value={form.imageUri}
            onChange={update("imageUri")}
            placeholder="ipfs://…"
          />
        </Field>
        <Field label="Description (optional)">
          <textarea
            className="textarea textarea-bordered w-full"
            rows={3}
            maxLength={LIMITS.description}
            value={form.description}
            onChange={update("description")}
            placeholder="What is this token about?"
          />
        </Field>

        <div className="bg-base-200 rounded-xl p-4 text-sm flex flex-col gap-1">
          <div className="flex justify-between">
            <span>Launch cost</span>
            <span className="font-semibold">{launchCost ? `≈ ${formatHbar(launchCost, 2)} HBAR` : "…"}</span>
          </div>
          <p className="text-xs text-base-content/60 m-0">
            HTS token creation (~$1) plus SaucerSwap&apos;s $2 pool fee, converted on-chain with Hedera&apos;s exchange
            rate system contract. Unused HBAR is refunded in the same transaction.
          </p>
        </div>

        <button type="submit" className="btn btn-primary btn-lg" disabled={!canSubmit}>
          {isMining ? <span className="loading loading-spinner" /> : address ? "Launch" : "Connect a wallet"}
        </button>
      </form>
    </div>
  );
};

const Field = ({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) => (
  <label className={`flex flex-col gap-1 ${className ?? ""}`}>
    <span className="text-xs font-medium text-base-content/70">{label}</span>
    {children}
  </label>
);

export default CreatePage;
