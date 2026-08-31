import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function lineCount(value: string): number {
  return value.split(/\r?\n/u).length;
}

describe("maintainability boundaries", () => {
  it("keeps Study route registration outside the general dashboard router", () => {
    const router = source("src/dashboard/route.ts");
    const studyRoutes = source("src/dashboard/studyRoutes.ts");

    expect(router).toContain("registerStudyDashboardRoutes(server, run");
    expect(router).not.toContain('server.get("/api/v1/dashboard/study/snapshot"');
    expect(studyRoutes).toContain('server.get("/api/v1/dashboard/study/snapshot"');
    expect(studyRoutes).toContain("requireDashboardStudyWorkspace(scope)");
    expect(lineCount(router)).toBeLessThanOrEqual(1_100);
  });

  it("keeps Beacon Telegram registration separate from moderation domains", () => {
    const community = source("src/community/index.ts");
    const registration = source("src/community/registration.ts");

    expect(community).toContain("createRegisteredBeaconBot(token, config");
    expect(community).not.toContain('bot.command("start"');
    expect(registration).toContain('bot.command("start"');
    expect(registration).toContain('bot.on("message"');
    expect(lineCount(community)).toBeLessThanOrEqual(2_800);
  });
});
