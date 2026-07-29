import {
  FileCourierJobStatus
} from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  fileCourierJobCanBeClaimed,
  isFileCourierActor
} from "./fileCourier";

describe("owner-only file courier state", () => {
  const scope = {
    ownerTelegramId: "5969845149",
    telegramChatId: "-5138765531"
  };

  it("requires both the exact configured owner and exact configured chat", () => {
    expect(isFileCourierActor({
      telegramUserId: "5969845149",
      telegramChatId: "-5138765531"
    }, scope)).toBe(true);
    expect(isFileCourierActor({
      telegramUserId: "999",
      telegramChatId: "-5138765531"
    }, scope)).toBe(false);
    expect(isFileCourierActor({
      telegramUserId: "5969845149",
      telegramChatId: "-999"
    }, scope)).toBe(false);
  });

  it("recovers expired leases after a worker restart but never duplicates a live lease", () => {
    const now = new Date("2026-07-29T12:00:00.000Z");
    expect(fileCourierJobCanBeClaimed(FileCourierJobStatus.PENDING, null, now)).toBe(true);
    expect(fileCourierJobCanBeClaimed(
      FileCourierJobStatus.RUNNING,
      new Date("2026-07-29T11:59:59.000Z"),
      now
    )).toBe(true);
    expect(fileCourierJobCanBeClaimed(
      FileCourierJobStatus.RUNNING,
      new Date("2026-07-29T12:00:01.000Z"),
      now
    )).toBe(false);
    expect(fileCourierJobCanBeClaimed(FileCourierJobStatus.COMPLETED, null, now)).toBe(false);
    expect(fileCourierJobCanBeClaimed(FileCourierJobStatus.CANCELED, null, now)).toBe(false);
  });
});
