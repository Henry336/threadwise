import { beforeEach, describe, expect, it, vi } from "vitest";

describe("Excel configuration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@example.com:5432/threadwise");
    vi.stubEnv("WEBHOOK_URL", "https://threadwise.example.com");
    vi.stubEnv("MICROSOFT_CLIENT_ID", "client-id");
    vi.stubEnv("MICROSOFT_CLIENT_SECRET", "client-secret");
    vi.stubEnv("MICROSOFT_TOKEN_ENCRYPTION_KEY", "microsoft-test-secret");
  });

  it("recognizes a complete Microsoft Excel configuration", async () => {
    const { microsoftExcelConfigured } = await import("./excel");
    expect(microsoftExcelConfigured()).toBe(true);
  }, 15_000);

  it("builds a usable workbook with the predefined expense columns", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const { buildExpenseWorkbook } = await import("./excel");
    const { EXPENSE_COLUMNS } = await import("./expenses");
    const buffer = await buildExpenseWorkbook([], "Asia/Singapore");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.getWorksheet("Expenses");

    expect(buffer.length).toBeGreaterThan(1_000);
    expect(sheet?.getRow(1).values).toEqual([undefined, ...EXPENSE_COLUMNS]);
    expect(sheet?.getTable("Expenses").name).toBe("Expenses");
  });
});
