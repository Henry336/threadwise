import { afterEach, describe, expect, it, vi } from "vitest";
import { TelegramAlbumBatcher, type TelegramAlbumBatch } from "./codexAttachmentBatch";

type Attachment = { id: string };
type TestContext = { id: string };

const batchers: Array<TelegramAlbumBatcher<Attachment, TestContext>> = [];

afterEach(() => {
  for (const batcher of batchers.splice(0)) batcher.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Telegram Codex attachment albums", () => {
  it("flushes one ordered task containing every attachment", async () => {
    const flushed: Array<TelegramAlbumBatch<Attachment, TestContext>> = [];
    const batcher = createBatcher(async (batch) => {
      flushed.push(batch);
    });

    batcher.add("album-1", {
      messageId: 102,
      attachment: { id: "second" },
      context: { id: "second-context" }
    });
    batcher.add("album-1", {
      messageId: 101,
      attachment: { id: "first" },
      context: { id: "caption-context" },
      caption: "Check all of these."
    });

    await expect(batcher.flush("album-1")).resolves.toBe(true);
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toMatchObject({
      key: "album-1",
      attachments: [{ id: "first" }, { id: "second" }],
      context: { id: "caption-context" },
      caption: "Check all of these."
    });
  });

  it("deduplicates a repeated Telegram message before queueing", async () => {
    const flushed: Array<TelegramAlbumBatch<Attachment, TestContext>> = [];
    const onFlush = vi.fn(async (batch: TelegramAlbumBatch<Attachment, TestContext>) => {
      flushed.push(batch);
    });
    const batcher = createBatcher(onFlush);

    expect(batcher.add("album-1", {
      messageId: 101,
      attachment: { id: "first" },
      context: { id: "context" }
    })).toEqual({ status: "accepted", count: 1 });
    expect(batcher.add("album-1", {
      messageId: 101,
      attachment: { id: "duplicate" },
      context: { id: "context" }
    })).toEqual({ status: "duplicate", count: 1 });

    await batcher.flush("album-1");
    expect(onFlush).toHaveBeenCalledOnce();
    expect(flushed[0]?.attachments).toEqual([{ id: "first" }]);
  });

  it("waits for the album to settle and resets the timer for later items", async () => {
    vi.useFakeTimers();
    const flushed: Array<TelegramAlbumBatch<Attachment, TestContext>> = [];
    const onFlush = vi.fn(async (batch: TelegramAlbumBatch<Attachment, TestContext>) => {
      flushed.push(batch);
    });
    const batcher = createBatcher(onFlush, 10, 1_500);

    batcher.add("album-1", {
      messageId: 1,
      attachment: { id: "first" },
      context: { id: "first" }
    });
    await vi.advanceTimersByTimeAsync(1_000);
    batcher.add("album-1", {
      messageId: 2,
      attachment: { id: "second" },
      context: { id: "second" }
    });

    await vi.advanceTimersByTimeAsync(1_499);
    expect(onFlush).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onFlush).toHaveBeenCalledOnce();
    expect(flushed[0]?.attachments).toEqual([
      { id: "first" },
      { id: "second" }
    ]);
  });

  it("keeps different Telegram albums separate", async () => {
    const flushed: Array<TelegramAlbumBatch<Attachment, TestContext>> = [];
    const onFlush = vi.fn(async (batch: TelegramAlbumBatch<Attachment, TestContext>) => {
      flushed.push(batch);
    });
    const batcher = createBatcher(onFlush);
    batcher.add("album-a", {
      messageId: 1,
      attachment: { id: "a" },
      context: { id: "a" }
    });
    batcher.add("album-b", {
      messageId: 2,
      attachment: { id: "b" },
      context: { id: "b" }
    });

    await batcher.flush("album-b");
    await batcher.flush("album-a");
    expect(flushed.map((batch) => batch.attachments)).toEqual([
      [{ id: "b" }],
      [{ id: "a" }]
    ]);
  });

  it("blocks the entire album after the configured attachment limit", async () => {
    const onFlush = vi.fn(async () => undefined);
    const batcher = createBatcher(onFlush, 2);
    batcher.add("album-1", {
      messageId: 1,
      attachment: { id: "a" },
      context: { id: "a" }
    });
    batcher.add("album-1", {
      messageId: 2,
      attachment: { id: "b" },
      context: { id: "b" }
    });

    expect(batcher.add("album-1", {
      messageId: 3,
      attachment: { id: "c" },
      context: { id: "c" }
    })).toEqual({ status: "overflow" });
    expect(batcher.add("album-1", {
      messageId: 4,
      attachment: { id: "d" },
      context: { id: "d" }
    })).toEqual({ status: "blocked" });
    await expect(batcher.flush("album-1")).resolves.toBe(false);
    expect(onFlush).not.toHaveBeenCalled();
  });
});

function createBatcher(
  onFlush: (batch: TelegramAlbumBatch<Attachment, TestContext>) => Promise<void>,
  maxItems = 10,
  settleMs = 60_000
): TelegramAlbumBatcher<Attachment, TestContext> {
  const batcher = new TelegramAlbumBatcher({
    settleMs,
    maxItems,
    onFlush
  });
  batchers.push(batcher);
  return batcher;
}
