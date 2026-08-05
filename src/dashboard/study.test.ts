import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  DashboardStudyAccessError,
  requireDashboardStudyWorkspace,
  studyModuleCreateSchema,
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
});
