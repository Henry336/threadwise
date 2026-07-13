import type { Context } from "grammy";
import { createStoredImageSearch, findStoredImageById, findStoredImageReference, findStoredImageSearch, formatStoredImageList, listStoredImages, searchStoredImages, type StoredImageSearchScope } from "../services/storedImages";
import { bold, code, HTML_REPLY, replyHtml } from "../utils/html";
import { storedImageActionsKeyboard, storedImageListKeyboard } from "./keyboards";

export async function replyStoredImageList(ctx: Context, userId: string, timezone = "UTC", requestedPage = 1): Promise<number> {
  const page = await listStoredImages(userId, requestedPage);
  await replyHtml(ctx, formatStoredImageList(page, timezone), {
    reply_markup: storedImageListKeyboard(page.images, page.page, page.totalPages, page.offset)
  });
  return page.page;
}

export async function replyStoredImageSearch(ctx: Context, userId: string, query: string, timezone = "UTC", requestedPage = 1, pendingId?: string, scope: StoredImageSearchScope = "all"): Promise<{ page: number; pendingId: string }> {
  const pending = pendingId ? await findStoredImageSearch(userId, pendingId) : await createStoredImageSearch(userId, query, scope);
  const savedScope = (pending.kinds.find((kind) => kind === "caption" || kind === "text") ?? "all") as StoredImageSearchScope;
  const page = await searchStoredImages(userId, pending.query, requestedPage, savedScope);
  await replyHtml(ctx, formatStoredImageList(page, timezone), {
    reply_markup: storedImageListKeyboard(page.images, page.page, page.totalPages, page.offset, pending.id)
  });
  return { page: page.page, pendingId: pending.id };
}

export async function replyStoredImage(ctx: Context, userId: string, reference: string, byRowId = false): Promise<void> {
  const image = byRowId ? await findStoredImageById(userId, reference) : await findStoredImageReference(userId, reference);
  const caption = [
    bold(image.caption || image.fileName || "Saved image"),
    `${bold("Image ID:")} ${code(image.publicId)}`
  ].join("\n");
  if (image.mediaKind === "document") {
    await ctx.replyWithDocument(image.telegramFileId, { caption, ...HTML_REPLY, reply_markup: storedImageActionsKeyboard(image.id) });
  } else {
    await ctx.replyWithPhoto(image.telegramFileId, { caption, ...HTML_REPLY, reply_markup: storedImageActionsKeyboard(image.id) });
  }
}
