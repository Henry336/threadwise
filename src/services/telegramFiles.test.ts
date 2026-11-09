import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadTelegramFile } from "./telegramFiles";

const pathResponse = (filePath: string) => Response.json({ ok: true, result: { file_path: filePath } });

function stubFetch(...responses: Array<Response | Error>) {
  const fetchMock = vi.fn();
  for (const response of responses) {
    if (response instanceof Error) fetchMock.mockRejectedValueOnce(response);
    else fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("downloadTelegramFile", () => {
  it("resolves the path, encodes it and returns the bytes with a timeout signal", async () => {
    const fetchMock = stubFetch(pathResponse("photos/private image.png"), new Response(new Uint8Array([1, 2, 3])));
    const { bytes } = await downloadTelegramFile("bot-secret", "file id", { maxBytes: 10 });
    expect([...bytes]).toEqual([1, 2, 3]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.telegram.org/botbot-secret/getFile?file_id=file%20id");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.telegram.org/file/botbot-secret/photos/private%20image.png");
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("downloads a large file (20 MB cap) with a size-scaled timeout", async () => {
    stubFetch(pathResponse("voice/note.ogg"), new Response(new Uint8Array([7])));
    await expect(downloadTelegramFile("token", "file", { maxBytes: 20 * 1024 * 1024 })).resolves.toMatchObject({ bytes: Buffer.from([7]) });
  });

  it("retries once from getFile after a transient failure", async () => {
    const fetchMock = stubFetch(
      pathResponse("photos/stale.jpg"),
      new Response(null, { status: 404 }),
      pathResponse("photos/fresh.jpg"),
      new Response(new Uint8Array([4])),
    );
    await expect(downloadTelegramFile("token", "file", { maxBytes: 10 })).resolves.toMatchObject({ bytes: Buffer.from([4]) });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("gives up after the single retry", async () => {
    const fetchMock = stubFetch(new TypeError("network down"), new Response(null, { status: 503 }));
    await expect(downloadTelegramFile("token", "file", { maxBytes: 10 })).rejects.toMatchObject({ reason: "temporary" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a file Telegram no longer has", async () => {
    const fetchMock = stubFetch(new Response(null, { status: 400 }));
    await expect(downloadTelegramFile("token", "file", { maxBytes: 10 })).rejects.toMatchObject({ reason: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects unsafe paths and files above the caller's cap without retrying", async () => {
    stubFetch(pathResponse("../escape"));
    await expect(downloadTelegramFile("token", "file", { maxBytes: 10 })).rejects.toMatchObject({ reason: "unavailable" });

    stubFetch(pathResponse("a.jpg"), new Response(new Uint8Array(4), { headers: { "content-length": "4" } }));
    await expect(downloadTelegramFile("token", "file", { maxBytes: 3 })).rejects.toMatchObject({ reason: "too_large" });

    // No content-length: the streamed body is still cut off at the cap.
    stubFetch(pathResponse("a.jpg"), new Response(new Uint8Array(4)));
    await expect(downloadTelegramFile("token", "file", { maxBytes: 3 })).rejects.toMatchObject({ reason: "too_large" });
  });

  it("never puts the bot token in the error message", async () => {
    stubFetch(new Response(null, { status: 500 }), new Response(null, { status: 500 }));
    await expect(downloadTelegramFile("bot-secret", "file", { maxBytes: 10 })).rejects.not.toThrow(/bot-secret/);
  });
});
