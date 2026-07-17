import type { Context } from "grammy";
import { createStoredImageSearch, findStoredImageById, findStoredImageReference, findStoredImageSearch, formatStoredImageList, listStoredImages, searchStoredImages, type StoredImageSearchScope } from "../services/storedImages";
import { bold, code, editOrReplyHtml, HTML_REPLY } from "../utils/html";
import { menuBackKeyboard, storedImageActionsKeyboard, storedImageListKeyboard } from "./keyboards";
import { rememberNewControlCard, replyControlCardHtml } from "./controlCards";

export async function replyStoredImageList(ctx: Context, userId: string, timezone = "UTC", requestedPage = 1, replaceCurrent = false): Promise<number> {
  const page = await listStoredImages(userId, requestedPage);
  const send = replaceCurrent ? editOrReplyHtml : replyControlCardHtml;
  await send(ctx, formatStoredImageList(page, timezone), {
    reply_markup: storedImageListKeyboard(page.images, page.page, page.totalPages, page.offset) ?? menuBackKeyboard()
  });
  return page.page;
}

export async function replyStoredImageSearch(ctx: Context, userId: string, query: string, timezone = "UTC", requestedPage = 1, pendingId?: string, scope: StoredImageSearchScope = "all", replaceCurrent = false): Promise<{ page: number; pendingId: string }> {
  const pending = pendingId ? await findStoredImageSearch(userId, pendingId) : await createStoredImageSearch(userId, query, scope);
  const savedScope = (pending.kinds.find((kind) => kind === "caption" || kind === "text") ?? "all") as StoredImageSearchScope;
  const page = await searchStoredImages(userId, pending.query, requestedPage, savedScope);
  const send = replaceCurrent ? editOrReplyHtml : replyControlCardHtml;
  await send(ctx, formatStoredImageList(page, timezone), {
    reply_markup: storedImageListKeyboard(page.images, page.page, page.totalPages, page.offset, pending.id) ?? menuBackKeyboard()
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
    const message = await ctx.replyWithDocument(image.telegramFileId, { caption, ...HTML_REPLY, reply_markup: storedImageActionsKeyboard(image.id) });
    await rememberNewControlCard(ctx, message);
  } else {
    const message = await ctx.replyWithPhoto(image.telegramFileId, { caption, ...HTML_REPLY, reply_markup: storedImageActionsKeyboard(image.id) });
    await rememberNewControlCard(ctx, message);
  }
}
