import { beforeEach, describe, expect, it, vi } from "vitest";
import { beginMenuInput, pendingMenuInput } from "./menuInputs";

const mocks = vi.hoisted(() => ({
  cancelPendingItemEdit: vi.fn(),
  cancelPendingExpenseEdits: vi.fn(),
  cancelPendingImageReminders: vi.fn()
}));

vi.mock("../services/itemEdits", () => ({ cancelPendingItemEdit: mocks.cancelPendingItemEdit }));
vi.mock("../services/expenses", () => ({ cancelPendingExpenseEdits: mocks.cancelPendingExpenseEdits }));
vi.mock("../services/imageOcr", () => ({ cancelPendingImageReminders: mocks.cancelPendingImageReminders }));

describe("transient interaction cancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cancelPendingItemEdit.mockResolvedValue(true);
    mocks.cancelPendingExpenseEdits.mockResolvedValue(1);
    mocks.cancelPendingImageReminders.mockResolvedValue(1);
  });

  it("clears every text-consuming prompt while leaving preservation to its service", async () => {
    beginMenuInput("user-1", 101, "task");
    const { cancelTransientInteractions } = await import("./interactions");

    const result = await cancelTransientInteractions("user-1", 101);

    expect(pendingMenuInput("user-1", 101)).toBeUndefined();
    expect(mocks.cancelPendingItemEdit).toHaveBeenCalledWith("user-1");
    expect(mocks.cancelPendingExpenseEdits).toHaveBeenCalledWith("user-1");
    expect(mocks.cancelPendingImageReminders).toHaveBeenCalledWith("user-1");
    expect(result).toEqual({ menuInput: true, itemEdit: true, expenseEdits: 1, imageReminders: 1 });
  });
});
