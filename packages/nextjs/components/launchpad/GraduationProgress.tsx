import { progressBps } from "~~/utils/launchpad/curve";
import { formatHbar } from "~~/utils/launchpad/units";

type GraduationProgressProps = { hbarRaised: bigint; threshold: bigint; graduated: boolean; compact?: boolean };

export const GraduationProgress = ({ hbarRaised, threshold, graduated, compact }: GraduationProgressProps) => {
  const percent = graduated ? 100 : progressBps(threshold, hbarRaised) / 100;

  return (
    <div className="w-full">
      <div className="flex justify-between text-xs mb-1">
        <span className="font-medium">{graduated ? "Graduated to SaucerSwap" : "Bonding curve"}</span>
        <span className="text-base-content/60">{percent.toFixed(compact ? 0 : 1)}%</span>
      </div>
      <progress
        className={`progress w-full ${graduated ? "progress-success" : "progress-primary"}`}
        value={percent}
        max={100}
      />
      {!compact && !graduated && (
        <p className="text-xs text-base-content/60 mt-1 m-0">
          {formatHbar(hbarRaised, 2)} / {formatHbar(threshold, 0)} HBAR raised. At {formatHbar(threshold, 0)} HBAR the
          curve closes and liquidity moves to SaucerSwap, locked forever.
        </p>
      )}
    </div>
  );
};
