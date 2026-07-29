import { describe, expect, it } from "vitest";
import {
  normalizeAppServerThreads,
  reconcileThreadProjectPaths,
  shortThreadId,
  threadTitle
} from "./codexThreadDiscovery";

describe("Codex app-server task discovery", () => {
  it("normalizes the same named tasks shown by the desktop app", () => {
    const threads = normalizeAppServerThreads([{
      id: "019fa9fc-b1f6-7280-9a3c-88d7a98a38d2",
      cwd: "C:\\Users\\Henry\\Documents\\Codex\\Threadwise",
      name: "Add Telegram Codex mode",
      preview: "Please add a private Telegram mode.",
      source: "vscode",
      status: { type: "notLoaded" },
      createdAt: 1_785_263_338,
      updatedAt: 1_785_285_760,
      recencyAt: 1_785_285_520
    }]);

    expect(threads).toEqual([{
      threadId: "019fa9fc-b1f6-7280-9a3c-88d7a98a38d2",
      path: "C:\\Users\\Henry\\Documents\\Codex\\Threadwise",
      title: "Add Telegram Codex mode",
      preview: "Please add a private Telegram mode.",
      source: "vscode",
      status: "notLoaded",
      createdAt: "2026-07-28T18:28:58.000Z",
      updatedAt: "2026-07-29T00:38:40.000Z"
    }]);
  });

  it("uses a concise preview title for unnamed Telegram-created threads", () => {
    expect(threadTitle(null, "Is this command being read?\nMore detail", "019fab4c-419d-7041-a25e-9c9a080182cd"))
      .toBe("Is this command being read?");
    expect(shortThreadId("019fab4c-419d-7041-a25e-9c9a080182cd")).toBe("019fab4c");
  });

  it("ignores malformed app-server records", () => {
    expect(normalizeAppServerThreads([
      { id: "", cwd: "C:\\repo" },
      { id: "thread", cwd: "" },
      null
    ])).toEqual([]);
  });

  it("maps final redirected paths back to the configured project path", async () => {
    const configured = "C:\\Users\\Henry\\Documents\\Codex\\Threadwise";
    const canonical = "D:\\CodexData\\WindowsDocuments\\Codex\\Threadwise";
    const unrelated = "D:\\Other\\Project";
    const resolver = async (path: string) => path === configured ? canonical : path;
    const threads = await reconcileThreadProjectPaths([
      {
        threadId: "desktop-thread",
        path: canonical,
        title: "Desktop task",
        source: "vscode"
      },
      {
        threadId: "unrelated-thread",
        path: unrelated,
        title: "Unrelated task",
        source: "vscode"
      }
    ], [configured], resolver);

    expect(threads).toEqual([{
      threadId: "desktop-thread",
      path: configured,
      title: "Desktop task",
      source: "vscode"
    }]);
  });

  it("falls back to literal path matching if canonicalization is unavailable", async () => {
    const configured = "C:\\repo\\Threadwise";
    const resolver = async () => {
      throw new Error("access denied");
    };

    await expect(reconcileThreadProjectPaths([{
      threadId: "thread",
      path: "c:/repo/Threadwise/",
      title: "Task",
      source: "exec"
    }], [configured], resolver)).resolves.toEqual([{
      threadId: "thread",
      path: configured,
      title: "Task",
      source: "exec"
    }]);
  });
});
