/**
 * Shared, bounded download of files users sent to the bot (images, voice notes, documents).
 * Used by image capture and Study capture in src/bot, the dashboard media proxies in src/dashboard,
 * voice transcription, and sideProjectRoutes. Errors are typed and never include the bot token.
 */
const DEFAULT_TIMEOUT_MS = 10_000;

/** Why a Telegram file could not be downloaded, so each caller can pick its own reply. */
export type TelegramFileFailure = "unavailable" | "too_large" | "temporary";

/** A downloaded file and the content type Telegram served it with (callers decide whether to trust it). */
export type TelegramFile = { bytes: Buffer; contentType?: string };

/** A failed Telegram download. The message never contains the bot token or file path. */
export class TelegramFileError extends Error {
  constructor(readonly reason: TelegramFileFailure, message: string) {
    super(message);
    this.name = "TelegramFileError";
  }
}

/**
 * Downloads one Telegram file by id: resolves a fresh download path with getFile, then streams
 * the bytes with a hard size cap and a per-request timeout. Telegram download paths are
 * short-lived and the Bot API has brief outages, so a transient failure (network error,
 * timeout, 429, 5xx, or a stale path answering 404/410) is retried once from getFile. A
 * missing file or an oversized one fails at once. This is the single download path for
 * the dashboard, Study, image OCR, voice notes and Codex attachments.
 */
export async function downloadTelegramFile(
  token: string,
  fileId: string,
  options: { maxBytes: number; timeoutMs?: number },
): Promise<TelegramFile> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    return await downloadOnce(token, fileId, options.maxBytes, timeoutMs);
  } catch (error) {
    if (!(error instanceof TelegramFileError) || error.reason !== "temporary") throw error;
    return downloadOnce(token, fileId, options.maxBytes, timeoutMs);
  }
}

/** One getFile plus download attempt; `downloadTelegramFile` decides whether to retry it. */
async function downloadOnce(token: string, fileId: string, maxBytes: number, timeoutMs: number): Promise<TelegramFile> {
  const metadata = await fetchWithTimeout(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`, timeoutMs);
  if (metadata.status === 400 || metadata.status === 404) throw unavailable();
  if (!metadata.ok) throw temporary();
  const payload = await metadata.json() as { ok?: boolean; result?: { file_path?: string } };
  const filePath = payload.ok ? payload.result?.file_path : undefined;
  if (!filePath || filePath.includes("..") || filePath.startsWith("/")) throw unavailable();
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const response = await fetchWithTimeout(`https://api.telegram.org/file/bot${token}/${encodedPath}`, timeoutMs);
  if (!response.ok) {
    if (response.status === 404 || response.status === 410 || response.status === 429 || response.status >= 500) throw temporary();
    throw unavailable();
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge(maxBytes);
  try {
    const bytes = await readWithinLimit(response, maxBytes);
    return { bytes, contentType: response.headers.get("content-type") ?? undefined };
  } catch (error) {
    if (error instanceof TelegramFileError) throw error;
    throw temporary(); // the body stream broke or timed out mid-download
  }
}

/** Fetches with a timeout, turning a network error or timeout into a retryable failure. */
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw temporary();
  }
}

/** Reads a response body but stops as soon as it passes `maxBytes`, so a huge file is never buffered. */
async function readWithinLimit(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, total);
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw tooLarge(maxBytes);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
}

function unavailable(): TelegramFileError {
  return new TelegramFileError("unavailable", "The original Telegram file is no longer available.");
}

function temporary(): TelegramFileError {
  return new TelegramFileError("temporary", "Telegram is temporarily unavailable. Retry in a moment.");
}

function tooLarge(maxBytes: number): TelegramFileError {
  return new TelegramFileError("too_large", `This file is larger than the ${Math.round(maxBytes / (1024 * 1024))} MB limit.`);
}
