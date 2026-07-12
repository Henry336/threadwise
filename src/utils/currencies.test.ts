import { describe, expect, it } from "vitest";
import { defaultCurrencyForTimezone, detectCurrency, normalizeCurrency } from "./currencies";

describe("currency utilities", () => {
  it.each([
    ["MMK", "MMK"],
    ["kyat", "MMK"],
    ["ringgit", "MYR"],
    ["baht", "THB"],
    ["US dollars", "USD"],
    ["NOK", "NOK"],
    ["ကျပ်", "MMK"]
  ])("normalizes %s", (input, expected) => {
    expect(normalizeCurrency(input)).toBe(expected);
  });

  it.each([
    ["TOTAL SGD 12.50", "MMK", "SGD"],
    ["TOTAL 12000 Ks", "SGD", "MMK"],
    ["စုစုပေါင်း ၁၂၀၀၀ ကျပ်", "SGD", "MMK"],
    ["TOTAL ฿450", "SGD", "THB"],
    ["TOTAL RM 22.90", "SGD", "MYR"],
    ["TOTAL $18.40", "SGD", "SGD"],
    ["TOTAL $18.40", "MMK", "USD"],
    ["TOTAL 18000", "MMK", "MMK"]
  ])("detects receipt currency in %s with fallback %s", (text, fallback, expected) => {
    expect(detectCurrency(text, fallback)).toBe(expected);
  });

  it("chooses useful regional defaults", () => {
    expect(defaultCurrencyForTimezone("Asia/Yangon")).toBe("MMK");
    expect(defaultCurrencyForTimezone("Asia/Kuala_Lumpur")).toBe("MYR");
    expect(defaultCurrencyForTimezone("America/New_York")).toBe("USD");
  });
});
