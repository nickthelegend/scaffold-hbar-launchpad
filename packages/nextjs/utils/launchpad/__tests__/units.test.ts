import {
  formatHbar,
  formatTokens,
  parseHbar,
  tinybarsToWeibars,
  tryParseAmount,
  weibarsToTinybars,
  withSlippage,
} from "../units";
import { describe, expect, it } from "vitest";

describe("units", () => {
  it("converts between tinybars (EVM) and weibars (JSON-RPC)", () => {
    expect(tinybarsToWeibars(1n)).toBe(10n ** 10n);
    expect(weibarsToTinybars(10n ** 18n)).toBe(10n ** 8n); // 1 HBAR
    expect(tinybarsToWeibars(parseHbar("2.5"))).toBe(25n * 10n ** 17n);
  });

  it("formats HBAR with trimmed decimals", () => {
    expect(formatHbar(150_000_000n)).toBe("1.5");
    expect(formatHbar(100_000_000n)).toBe("1");
    expect(formatHbar(123_456_789n, 2)).toBe("1.23");
  });

  it("formats large token amounts compactly", () => {
    expect(formatTokens(812_400_000n * 10n ** 8n)).toBe("812.4M");
    expect(formatTokens(1_500n * 10n ** 8n)).toBe("1500");
  });

  it("applies slippage rounding down", () => {
    expect(withSlippage(10_000n, 100)).toBe(9_900n);
    expect(withSlippage(999n, 100)).toBe(989n);
  });

  it("returns undefined for unparseable input", () => {
    expect(tryParseAmount(parseHbar, "1.5")).toBe(150_000_000n);
    expect(tryParseAmount(parseHbar, "1.2.3")).toBeUndefined();
  });
});
