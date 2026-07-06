import { describe, expect, it } from "vitest";
import { isValidTimezone, parseTimezone } from "./timezones";

describe("timezone parsing", () => {
  it("accepts valid IANA timezone names", () => {
    expect(parseTimezone("Asia/Yangon")).toEqual({
      ok: true,
      timezone: "Asia/Yangon",
      wasAlias: false
    });
    expect(isValidTimezone("America/New_York")).toBe(true);
  });

  it("normalizes common Myanmar aliases to the IANA timezone", () => {
    expect(parseTimezone("Asia/Myanmar")).toEqual({
      ok: true,
      timezone: "Asia/Yangon",
      wasAlias: true
    });
    expect(parseTimezone("Myanmar")).toEqual({
      ok: true,
      timezone: "Asia/Yangon",
      wasAlias: true
    });
  });

  it("normalizes common Malaysia aliases to the IANA timezone", () => {
    expect(parseTimezone("Malaysia")).toEqual({
      ok: true,
      timezone: "Asia/Kuala_Lumpur",
      wasAlias: true
    });
    expect(parseTimezone("KL")).toEqual({
      ok: true,
      timezone: "Asia/Kuala_Lumpur",
      wasAlias: true
    });
  });

  it("rejects unknown timezone names", () => {
    expect(parseTimezone("Potato/Nowhere")).toEqual({
      ok: false,
      input: "Potato/Nowhere"
    });
  });
});
