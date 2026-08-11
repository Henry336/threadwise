import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  DashboardStudyAccessError,
  loadDashboardStudyResourceContent,
  requireDashboardStudyWorkspace,
  studyModuleCreateSchema,
  studyScheduleCreateSchema,
  studyScheduleUpdateSchema,
} from "./study";
import type { DashboardWorkspaceScope } from "./workspaces";

const owner = "900000001";
const chat = "-100900000001";
const config = { ownerTelegramId: owner, allowedChatId: chat };
const workspace = {
  id: "study-workspace",
  ownerTelegramId: owner,
  boundChatId: chat,
  active: true,
  semesterName: "AY26/27 Semester 1",
};

function scope(overrides: Partial<DashboardWorkspaceScope> = {}): DashboardWorkspaceScope {
  return {
    principalTelegramId: owner,
    ownerTelegramId: `chat:${chat}`,
    telegramChatId: chat,
    workspace: {
      id: "6cd8f630-05f4-48c0-b7fb-ffacbc4ff1a2",
      kind: "GROUP",
      name: "Study",
      role: "OWNER",
      mode: "STUDY",
    },
    ...overrides,
  };
}

describe("private Study dashboard authorization", () => {
  it("allows only the configured principal in the active bound Study group", async () => {
    const findFirst = vi.fn(async () => workspace);
    const database = { studyWorkspace: { findFirst } } as unknown as PrismaClient;

    await expect(requireDashboardStudyWorkspace(scope(), database, config)).resolves.toMatchObject({ id: "study-workspace" });
    expect(findFirst).toHaveBeenCalledWith({
      where: { ownerTelegramId: owner, boundChatId: chat, active: true },
    });
  });

  it.each([
    ["personal workspace", { workspace: { id: "personal", kind: "PERSONAL", name: "Personal", role: "OWNER" } }],
    ["ordinary group mode", { workspace: { id: "group", kind: "GROUP", name: "Group", role: "OWNER" } }],
    ["different Telegram user", { principalTelegramId: "123456789" }],
    ["different Telegram group", { telegramChatId: "-100999" }],
  ])("returns the same opaque denial for a %s", async (_label, overrides) => {
    const database = { studyWorkspace: { findFirst: vi.fn() } } as unknown as PrismaClient;
    await expect(requireDashboardStudyWorkspace(scope(overrides as Partial<DashboardWorkspaceScope>), database, config))
      .rejects.toEqual(expect.objectContaining({ name: "DashboardStudyAccessError", message: "Not found." }));
  });

  it("fails closed when the configured Study workspace is inactive or missing", async () => {
    const database = { studyWorkspace: { findFirst: vi.fn(async () => null) } } as unknown as PrismaClient;
    await expect(requireDashboardStudyWorkspace(scope(), database, config)).rejects.toBeInstanceOf(DashboardStudyAccessError);
  });

  it("fails closed when Study Mode is not configured", async () => {
    const database = { studyWorkspace: { findFirst: vi.fn() } } as unknown as PrismaClient;
    await expect(requireDashboardStudyWorkspace(scope(), database, undefined)).rejects.toBeInstanceOf(DashboardStudyAccessError);
  });
});

describe("Study dashboard input contracts", () => {
  it("accepts the module color chosen by the creation sheet", () => {
    expect(studyModuleCreateSchema.parse({
      code: "CS2100",
      name: "Computer Organisation",
      color: "#168b83",
    })).toEqual({
      code: "CS2100",
      name: "Computer Organisation",
      color: "#168b83",
    });
  });

  it("accepts an optional live-travel destination on a schedule block", () => {
    expect(studyScheduleCreateSchema.parse({
      dayOfWeek: 3,
      startTime: "14:00",
      endTime: "16:00",
      label: "CS2100 lecture",
      destination: "COM3",
      destinationPlaceId: "venue:COM3",
      defaultOriginId: "dfe7ff93-a82a-44d6-af67-fc64d29012bf",
      travelBufferMinutes: 15,
    })).toMatchObject({ destination: "COM3", destinationPlaceId: "venue:COM3", travelBufferMinutes: 15 });
  });

  it("allows travel reminders to be disabled without deleting the block", () => {
    expect(studyScheduleUpdateSchema.parse({ destination: null })).toEqual({ destination: null });
  });

  it("accepts full timetable edits without recreating the block", () => {
    expect(studyScheduleUpdateSchema.parse({
      moduleId: null,
      dayOfWeek: 5,
      startTime: "09:00",
      endTime: "11:00",
      label: "Revision block",
      blockType: "study",
      startWeek: 2,
      endWeek: 13,
    })).toMatchObject({ dayOfWeek: 5, startTime: "09:00", endWeek: 13 });
  });
});

describe("Study Telegram resource delivery", () => {
  const resource = {
    id: "resource-1",
    publicId: "SIMG-1",
    telegramFileId: "telegram-file-1",
    mimeType: "image/jpeg",
    fileName: "lecture.jpg",
  };

  it("streams a freshly resolved Telegram file with its safe upstream MIME", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: true, result: { file_path: "photos/fresh.jpg" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } }));
    const result = await loadDashboardStudyResourceContent(
      workspace as never,
      resource.id,
      "token",
      fetcher as typeof fetch,
      vi.fn(async () => resource) as never,
    );
    expect(result.contentType).toBe("image/png");
    expect(result.inline).toBe(true);
    expect([...result.bytes]).toEqual([1, 2, 3]);
  });

  it("resolves a new Telegram path once when the first download URL is stale", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: true, result: { file_path: "photos/stale.jpg" } }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ ok: true, result: { file_path: "photos/fresh.jpg" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([4]), { status: 200, headers: { "content-type": "image/jpeg" } }));
    await expect(loadDashboardStudyResourceContent(
      workspace as never,
      resource.id,
      "token",
      fetcher as typeof fetch,
      vi.fn(async () => resource) as never,
    )).resolves.toMatchObject({ contentType: "image/jpeg" });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("sniffs historical image bytes when Telegram returns a generic MIME", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: true, result: { file_path: "photos/historical.bin" } }))
      .mockResolvedValueOnce(new Response(png, { status: 200, headers: { "content-type": "application/octet-stream" } }));
    await expect(loadDashboardStudyResourceContent(
      workspace as never,
      resource.id,
      "token",
      fetcher as typeof fetch,
      vi.fn(async () => ({ ...resource, mimeType: null })) as never,
    )).resolves.toMatchObject({ contentType: "image/png", inline: true });
  });

  it("separates a removed original from a temporary Telegram failure", async () => {
    const loader = vi.fn(async () => resource) as never;
    const missing = vi.fn(async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
    await expect(loadDashboardStudyResourceContent(workspace as never, resource.id, "token", missing, loader))
      .rejects.toMatchObject({ code: "not_found", message: "The original Telegram file is no longer available." });

    const temporary = vi.fn(async () => new Response(null, { status: 503 })) as unknown as typeof fetch;
    await expect(loadDashboardStudyResourceContent(workspace as never, resource.id, "token", temporary, loader))
      .rejects.toMatchObject({ code: "invalid", message: "Telegram is temporarily unavailable. Retry in a moment." });
  });
});
