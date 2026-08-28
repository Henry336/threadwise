import { PlanningScope, TaskCaptureDraftStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { getDashboardTaskCaptureDraft, TodayFoundationAccessError } from "./today";
import type { DashboardWorkspaceScope } from "./workspaces";

const personalScope: DashboardWorkspaceScope = {
  principalTelegramId: "123",
  ownerTelegramId: "123",
  workspace: { id: "personal", kind: "PERSONAL", name: "Personal", role: "OWNER" },
};

describe("Today dashboard workspace authorization", () => {
  it("rejects a same-principal draft from another workspace", async () => {
    const findFirst = vi.fn(async () => ({
      id: "draft-group",
      ownerUserId: "group-owner",
      principalTelegramId: "123",
      scope: PlanningScope.GROUP,
      groupWorkspaceId: "group-2",
      studyWorkspaceId: null,
      status: TaskCaptureDraftStatus.REVIEWING,
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      items: [],
    }));
    const database = {
      user: { findUnique: vi.fn(async () => ({ id: "user-1", settings: { timezone: "Asia/Singapore" } })) },
      taskCaptureDraft: { findFirst },
    } as never;

    await expect(getDashboardTaskCaptureDraft(personalScope, "draft-group", database))
      .rejects.toBeInstanceOf(TodayFoundationAccessError);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "draft-group", principalTelegramId: "123" },
    }));
  });

  it("rejects another principal before workspace comparison", async () => {
    const findFirst = vi.fn(async () => null);
    const database = {
      user: { findUnique: vi.fn(async () => ({ id: "user-1", settings: { timezone: "Asia/Singapore" } })) },
      taskCaptureDraft: { findFirst },
    } as never;

    await expect(getDashboardTaskCaptureDraft(personalScope, "someone-elses-draft", database))
      .rejects.toEqual(expect.objectContaining({ code: "not_found" }));
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "someone-elses-draft", principalTelegramId: "123" },
    }));
  });
});
