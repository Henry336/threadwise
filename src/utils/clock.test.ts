import { describe, expect, it } from "vitest";
import { normalizeClock } from "./clock";

describe("normalizeClock", () => {
  it.each([
    ["3:00", "03:00"],
    ["03:00", "03:00"],
    [" 6:05 ", "06:05"],
    ["23:59", "23:59"],
    ["0:00", "00:00"]
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeClock(input)).toBe(expected);
  });

  it.each([undefined, null, "", "3:0", "24:00", "12:60", "noon"])("rejects %s", (input) => {
    expect(normalizeClock(input)).toBeUndefined();
  });
});
