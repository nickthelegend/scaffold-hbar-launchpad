"use client";

import { useState } from "react";

type TokenAvatarProps = { imageUri?: string; symbol?: string; size?: number };

/** Shows a launch's image, falling back to a gradient tile with the symbol's first letter. */
export const TokenAvatar = ({ imageUri, symbol, size = 48 }: TokenAvatarProps) => {
  const [failed, setFailed] = useState(false);
  const src = resolveImageUri(imageUri);

  if (src && !failed) {
    return (
      // Launch images are arbitrary user URLs, so next/image optimisation does not apply.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={symbol ?? "token"}
        width={size}
        height={size}
        onError={() => setFailed(true)}
        className="rounded-xl object-cover shrink-0 bg-base-200"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className="rounded-xl hedera-gradient flex items-center justify-center text-white font-bold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden
    >
      {symbol?.charAt(0).toUpperCase() ?? "?"}
    </div>
  );
};

/** Rewrites ipfs:// URIs to a public gateway; passes http(s) through and rejects anything else. */
function resolveImageUri(uri?: string): string | undefined {
  if (!uri) return undefined;
  if (uri.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${uri.slice("ipfs://".length)}`;
  if (uri.startsWith("https://") || uri.startsWith("http://")) return uri;
  return undefined;
}
