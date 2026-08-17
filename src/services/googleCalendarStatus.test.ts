import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  calendarConnection: vi.fn(),
  settings: vi.fn(),
  syncedTasks: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("../db/prisma", () => ({
  prisma: {
    calendarConnection: { findUnique: mocks.calendarConnection },
    userSettings: { findUnique: mocks.settings },
    task: { count: mocks.syncedTasks },
  },
}));

vi.mock("../logger", () => ({
  logger: { warn: mocks.warn, error: vi.fn(), info: vi.fn() },
}));

describe("Google Calendar connection health", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@example.com:5432/threadwise");
    vi.stubEnv("WEBHOOK_URL", "https://threadwise.example.com");
    vi.stubEnv("WEBHOOK_SECRET_TOKEN", "test_webhook_secret_0123456789_ABCDEFG");
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
    vi.stubEnv("GOOGLE_TOKEN_ENCRYPTION_KEY", "calendar-test-secret-key");
    mocks.calendarConnection.mockResolvedValue({
      id: "calendar-1",
      userId: "user-1",
      calendarEmail: "person@example.com",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      accessTokenExpiresAt: new Date(Date.now() + 30 * 60_000),
    });
    mocks.settings.mockResolvedValue({ calendarAutoSync: true });
    mocks.syncedTasks.mockResolvedValue(3);
  });

  it("marks an externally rejected token as requiring reconnection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 401 })));
    const { calendarConnectionStatus } = await import("./googleCalendar");

    await expect(calendarConnectionStatus("user-1")).resolves.toMatchObject({
      connected: false,
      reconnectRequired: true,
      email: "person@example.com",
      autoSync: true,
      syncedTasks: 3,
    });
    expect(mocks.warn).toHaveBeenCalledWith(
      "Google Calendar connection validation failed.",
      expect.objectContaining({ userId: "user-1", connectionId: "calendar-1" }),
    );
  });

  it("reports connected only after Google accepts the saved token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"kind":"calendar#events"}', {
      status: 200,
      headers: { "content-type": "application/json" },
    })));
    const { calendarConnectionStatus } = await import("./googleCalendar");

    await expect(calendarConnectionStatus("user-1")).resolves.toMatchObject({
      connected: true,
      reconnectRequired: false,
      email: "person@example.com",
    });
  });
});
