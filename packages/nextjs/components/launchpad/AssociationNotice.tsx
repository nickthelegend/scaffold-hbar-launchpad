type AssociationNoticeProps = { symbol: string; onAssociate: () => void; isAssociating: boolean };

/** Explains HTS token association and offers the one-click HIP-719 `associate()` transaction. */
export const AssociationNotice = ({ symbol, onAssociate, isAssociating }: AssociationNoticeProps) => (
  <div className="flex flex-col gap-2">
    <p className="text-xs text-base-content/70 m-0">
      Your Hedera account has no free auto-association slots, so it must opt in to ${symbol} before it can hold it. This
      is a one-time transaction.
    </p>
    <button className="btn btn-secondary" disabled={isAssociating} onClick={onAssociate}>
      {isAssociating ? <span className="loading loading-spinner loading-sm" /> : `Associate ${symbol}`}
    </button>
  </div>
);
