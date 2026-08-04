import {
  FileCourierJobKind,
  FileCourierJobStatus
} from "@prisma/client";
import { describe, expect, it } from "vitest";
import type { FileCourierJobWithResults } from "../services/fileCourier";
import {
  deliverFileCourierJobOnce,
  fileResultKeyboard,
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

  it("paginates stored results with global numbering and matching Send controls", () => {
    const job = paginatedJob(10);
    const first = renderFileCourierResult(job, 0);
    expect(first).toContain("Page 1 of 2 · 10 results");
    expect(first).toContain("1. resume-1.pdf");
    expect(first).toContain("8. resume-8.pdf");
    expect(first).not.toContain("9. resume-9.pdf");

    const second = renderFileCourierResult(job, 1);
    expect(second).toContain("Page 2 of 2 · 10 results");
    expect(second).toContain("9. resume-9.pdf");
    expect(second).toContain("10. resume-10.pdf");
    expect(second).not.toContain("1. resume-1.pdf");

    const firstButtons = fileResultKeyboard(job, 0)!.inline_keyboard.flat();
    expect(firstButtons.map((button) => button.text)).toContain("Next ▶");
    expect(firstButtons.map((button) => button.text)).not.toContain("◀ Previous");
    expect(firstButtons.find((button) => button.text === "Send 8")).toMatchObject({
      callback_data: "files:send:result-8"
    });

    const secondButtons = fileResultKeyboard(job, 1)!.inline_keyboard.flat();
    expect(secondButtons.map((button) => button.text)).toContain("◀ Previous");
    expect(secondButtons.map((button) => button.text)).not.toContain("Next ▶");
    expect(secondButtons.find((button) => button.text === "Send 9")).toMatchObject({
      callback_data: "files:send:result-9"
    });
  });

  it("clamps stale page callbacks and explains the stored-result safety cap", () => {
    const job = paginatedJob(100);
    const rendered = renderFileCourierResult(job, 99);
    expect(rendered).toContain("Page 13 of 13 · 100 results");
    expect(rendered).toContain("Showing the first 100 matches");
    expect(rendered).toContain("97. resume-97.pdf");
    expect(rendered).toContain("100. resume-100.pdf");
  });

  it("keeps worst-case pages and callbacks within Telegram limits", () => {
    const job = paginatedJob(100);
    job.query = "q".repeat(180);
    for (const result of job.results) {
      result.fileName = `${"n".repeat(96)}.pdf`;
      result.parentPath = `D:\\${"p".repeat(137)}`;
      result.fileType = "t".repeat(100);
    }
    expect(renderFileCourierResult(job, 0).length).toBeLessThanOrEqual(4_096);
    const callbackData = fileResultKeyboard(job, 0)!.inline_keyboard
      .flat()
      .map((button) => "callback_data" in button ? button.callback_data : undefined)
      .filter((value): value is string => Boolean(value));
    expect(Math.max(...callbackData.map((value) => Buffer.byteLength(value, "utf8")))).toBeLessThanOrEqual(64);
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

function paginatedJob(resultCount: number): FileCourierJobWithResults {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    ownerTelegramId: "123",
    telegramChatId: "-456",
    requesterTelegramId: "123",
    telegramRequestMessageId: 1,
    kind: FileCourierJobKind.SEARCH,
    status: FileCourierJobStatus.COMPLETED,
    query: "resume",
    sortLatest: false,
    deliveredAt: null,
    results: Array.from({ length: resultCount }, (_, index) => ({
      id: `result-${index + 1}`,
      jobId: "11111111-1111-1111-1111-111111111111",
      absolutePath: `D:\\Documents\\resume-${index + 1}.pdf`,
      fileName: `resume-${index + 1}.pdf`,
      parentPath: "D:\\Documents",
      sizeBytes: BigInt(1_024 + index),
      modifiedAt: new Date(2026, 6, 29, 12, 0, index),
      identityKey: `identity-${index + 1}`,
      mimeType: "application/pdf",
      fileType: "PDF",
      createdAt: new Date()
    }))
  } as unknown as FileCourierJobWithResults;
}
