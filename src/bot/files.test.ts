import {
  FileCourierJobKind,
  FileCourierJobStatus
} from "@prisma/client";
import { describe, expect, it } from "vitest";
import type { FileCourierJobWithResults } from "../services/fileCourier";
import {
  deliverFileCourierJobOnce,
  parseFileCourierCommand,
  parseNaturalLaptopFileRequest,
  renderFileCourierResult
} from "./files";

describe("owner laptop file commands", () => {
  it("parses each explicit /files operation without overlapping /codex", () => {
    expect(parseFileCourierCommand("find curriculum PDF")).toEqual({
      action: "search",
      query: "curriculum PDF",
      sortLatest: false
    });
    expect(parseFileCourierCommand("recent")).toEqual({ action: "recent" });
    expect(parseFileCourierCommand('get "C:\\Users\\Henry\\report.pdf"')).toEqual({
      action: "lookup",
      path: "C:\\Users\\Henry\\report.pdf"
    });
  });

  it("recognizes only clear natural laptop-file requests", () => {
    expect(parseNaturalLaptopFileRequest("Send me the latest curriculum PDF from my laptop.")).toEqual({
      action: "search",
      query: "curriculum PDF",
      sortLatest: true
    });
    expect(parseNaturalLaptopFileRequest("Find enrollment spreadsheet on my laptop")).toEqual({
      action: "search",
      query: "enrollment spreadsheet",
      sortLatest: false
    });
    expect(parseNaturalLaptopFileRequest("Please improve this file handler.")).toBeUndefined();
  });

  it("renders duplicate filenames with their distinct parent folders and metadata", () => {
    const job = {
      id: "11111111-1111-1111-1111-111111111111",
      ownerTelegramId: "123",
      telegramChatId: "-456",
      requesterTelegramId: "123",
      telegramRequestMessageId: 1,
      kind: FileCourierJobKind.SEARCH,
      status: FileCourierJobStatus.COMPLETED,
      query: "report",
      sortLatest: false,
      deliveredAt: null,
      results: [
        {
          id: "a",
          jobId: "j",
          absolutePath: "C:\\One\\report.pdf",
          fileName: "report.pdf",
          parentPath: "C:\\One",
          sizeBytes: 1_024n,
          modifiedAt: new Date("2026-07-29T01:00:00.000Z"),
          identityKey: "one",
          mimeType: "application/pdf",
          fileType: "PDF",
          createdAt: new Date()
        },
        {
          id: "b",
          jobId: "j",
          absolutePath: "C:\\Two\\report.pdf",
          fileName: "report.pdf",
          parentPath: "C:\\Two",
          sizeBytes: 2_048n,
          modifiedAt: new Date("2026-07-28T01:00:00.000Z"),
          identityKey: "two",
          mimeType: "application/pdf",
          fileType: "PDF",
          createdAt: new Date()
        }
      ]
    } as unknown as FileCourierJobWithResults;
    const rendered = renderFileCourierResult(job);
    expect(rendered).toContain("C:\\One");
    expect(rendered).toContain("C:\\Two");
    expect(rendered.match(/report\.pdf/g)).toHaveLength(2);
    expect(rendered).toContain("1.0 KB");
    expect(rendered).toContain("2.0 KB");
  });

  it("surfaces Telegram delivery failure without marking the result delivered", async () => {
    const job = {
      id: "11111111-1111-1111-1111-111111111111",
      ownerTelegramId: "123",
      telegramChatId: "-456",
      requesterTelegramId: "123",
      kind: FileCourierJobKind.SEARCH,
      status: FileCourierJobStatus.COMPLETED,
      query: "report",
      sortLatest: false,
      deliveredAt: null,
      results: []
    } as unknown as FileCourierJobWithResults;
    const bot = {
      api: {
        sendMessage: async () => {
          throw new Error("Telegram unavailable");
        }
      }
    };
    await expect(deliverFileCourierJobOnce(bot as never, job)).rejects.toThrow(/Telegram unavailable/);
  });
});
