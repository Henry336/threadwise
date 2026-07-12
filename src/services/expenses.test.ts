import { describe, expect, it } from "vitest";
import { decodeExpenseFilter, encodeExpenseFilter, parseExpenseFilter, parseExpenseText } from "./expenses";

describe("expense parsing", () => {
  it("parses conversational manual expenses", () => {
    const parsed = parseExpenseText(
      "Spent $18.40 on lunch at Toast Box today using Visa",
      "Asia/Singapore",
      new Date("2026-07-12T04:00:00.000Z")
    );
    expect(parsed).toMatchObject({
      merchant: "Toast Box",
      category: "Food",
      description: "lunch",
      total: 18.4,
      currency: "SGD",
      paymentMethod: "Visa"
    });
    expect(parsed?.transactionAt.toISOString()).toBe("2026-07-11T16:00:00.000Z");
  });

  it("extracts common receipt fields without AI", () => {
    const parsed = parseExpenseText([
      "FAIRPRICE FINEST",
      "12/07/2026",
      "SUBTOTAL 23.00",
      "GST 2.07",
      "TOTAL SGD 25.07",
      "VISA"
    ].join("\n"), "Asia/Singapore");
    expect(parsed).toMatchObject({
      merchant: "FAIRPRICE FINEST",
      category: "Groceries",
      subtotal: 23,
      tax: 2.07,
      total: 25.07,
      currency: "SGD",
      paymentMethod: "Visa"
    });
  });

  it("uses the user's currency when a receipt has no currency marker", () => {
    const parsed = parseExpenseText("CITY MART\nTOTAL 12500", "Asia/Yangon", new Date("2026-07-12T04:00:00.000Z"), "MMK");
    expect(parsed).toMatchObject({ merchant: "CITY MART", total: 12500, currency: "MMK" });
  });

  it("lets an explicit currency override the user's default", () => {
    const parsed = parseExpenseText("spent USD 20 on lunch", "Asia/Yangon", new Date("2026-07-12T04:00:00.000Z"), "MMK");
    expect(parsed).toMatchObject({ total: 20, currency: "USD" });
  });

  it("parses Myanmar digits and kyat from Burmese receipt text", () => {
    const parsed = parseExpenseText("City Mart\nTOTAL ၁၂,၅၀၀ ကျပ်", "Asia/Yangon", new Date("2026-07-12T00:00:00Z"), "SGD");
    expect(parsed?.total).toBe(12500);
    expect(parsed?.currency).toBe("MMK");
  });

  it.each([
    ["today", { kind: "day", value: "2026-07-12" }],
    ["12 July 2026", { kind: "day", value: "2026-07-12" }],
    ["July 11", { kind: "day", value: "2026-07-11" }],
    ["this month", { kind: "month", value: "2026-07" }],
    ["June 2026", { kind: "month", value: "2026-06" }],
    ["2025", { kind: "year", value: "2025" }],
    ["all expenses", { kind: "all" }]
  ])("parses expense filters: %s", (input, expected) => {
    expect(parseExpenseFilter(input, "Asia/Singapore", new Date("2026-07-12T04:00:00.000Z"))).toMatchObject(expected);
  });

  it("round-trips compact pagination filters", () => {
    const filter = { kind: "month" as const, value: "2026-07", label: "July 2026" };
    expect(decodeExpenseFilter(encodeExpenseFilter(filter))).toMatchObject({ kind: "month", value: "2026-07" });
  });
});
