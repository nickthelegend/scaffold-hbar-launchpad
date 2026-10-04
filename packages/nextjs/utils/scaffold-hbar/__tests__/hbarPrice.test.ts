import { priceFromExchangeRate } from "../hbarPrice";
import { describe, expect, it } from "vitest";

describe("priceFromExchangeRate", () => {
  it("converts the network rate (cents per N hbar) to USD per HBAR", () => {
    expect(priceFromExchangeRate({ current_rate: { cent_equivalent: 305452, hbar_equivalent: 30000 } })).toBeCloseTo(
      0.1018,
      4,
    );
  });

  it("returns undefined for a malformed response", () => {
    expect(priceFromExchangeRate({})).toBeUndefined();
    expect(priceFromExchangeRate({ current_rate: { cent_equivalent: 1, hbar_equivalent: 0 } })).toBeUndefined();
  });
});
