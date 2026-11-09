import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock("../logger", () => ({ logger }));

import { startLoop } from "./loop";

describe("startLoop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("logs a throwing tick and still runs the next one", async () => {
    const tick = vi.fn()
      .mockRejectedValueOnce(new Error("database blip"))
      .mockResolvedValue(undefined);
    const stop = startLoop("Test", 1_000, tick);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(logger.error).toHaveBeenCalledWith("Test loop failed.", { error: "Error: database blip" });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(tick).toHaveBeenCalledTimes(2);
    stop();
  });

  it("skips a tick while the previous one is still running", async () => {
    let finish!: () => void;
    const tick = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const stop = startLoop("Slow", 1_000, tick, { runImmediately: true });

    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(tick).toHaveBeenCalledTimes(1);

    finish();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(tick).toHaveBeenCalledTimes(2);
    stop();
  });

  it("stops scheduling ticks once stopped", async () => {
    const tick = vi.fn();
    const stop = startLoop("Stopped", 1_000, tick);

    stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(tick).not.toHaveBeenCalled();
  });
});
