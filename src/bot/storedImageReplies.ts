/**
 * Telegram replies for saved images: the paged list, search results, and a single image card.
 * Data and formatting come from services/storedImages.ts; this file picks the keyboard and
 * registers the reply as the chat's current control card.
 */
import type { Context } from "grammy";
import { createStoredImageSearch, findStoredImageById, findStoredImageReference, findStoredImageSearch, formatStoredImageList, listStoredImages, searchStoredImages, type StoredImageSearchScope } from "../services/storedImages";
import { bold, code, editOrReplyHtml, h, HTML_REPLY } from "../utils/html";
import { menuBackKeyboard, storedImageActionsKeyboard, storedImageListKeyboard } from "./keyboards";
import { rememberNewControlCard, replyControlCardHtml } from "./controlCards";
import { isGroupChat } from "./groupRouting";
import { groupWorkspaceForContext } from "../services/groupWorkspaces";

/** The confirmation text shown before deleting a saved image, the same from a button, /image or text. */
export function formatStoredImageDeletePrompt(image: { publicId: string; caption?: string | null; fileName?: string | null }): string {
  return `${bold("⚠️ Delete saved image?")}\n${code(image.publicId)} ${h(image.caption || image.fileName || "Saved image")}\nIt is removed from your saved images and search. An archived copy stays with your account until you delete your data.`;
}

/**
 * Shows one page of saved images. With replaceCurrent it edits the tapped card (paging) instead of
 * sending a new one. In groups the workspace id is passed so keyboard links open the group dashboard.
 * Returns the page actually shown, which may be clamped.
 */
export async function replyStoredImageList(ctx: Context, userId: string, timezone = "UTC", requestedPage = 1, replaceCurrent = false, selecting = false): Promise<number> {
  const page = await listStoredImages(userId, requestedPage);
  const send = replaceCurrent ? editOrReplyHtml : replyControlCardHtml;
  const workspace = isGroupChat(ctx) ? await groupWorkspaceForContext(ctx) : undefined;
  await send(ctx, formatStoredImageList(page, timezone), {
    reply_markup: storedImageListKeyboard(page.images, page.page, page.totalPages, page.offset, undefined, selecting, workspace?.id) ?? menuBackKeyboard()
  });
  return page.page;
}

/**
 * Shows a page of image search results. The first call stores the query as a PendingSearch row;
 * paging buttons then carry only its id, because Telegram callback data is too small for the query.
 */
export async function replyStoredImageSearch(ctx: Context, userId: string, query: string, timezone = "UTC", requestedPage = 1, pendingId?: string, scope: StoredImageSearchScope = "all", replaceCurrent = false, selecting = false): Promise<{ page: number; pendingId: string }> {
  const pending = pendingId ? await findStoredImageSearch(userId, pendingId) : await createStoredImageSearch(userId, query, scope);
  const savedScope = (pending.kinds.find((kind) => kind === "caption" || kind === "text") ?? "all") as StoredImageSearchScope;
  const page = await searchStoredImages(userId, pending.query, requestedPage, savedScope);
  const send = replaceCurrent ? editOrReplyHtml : replyControlCardHtml;
  const workspace = isGroupChat(ctx) ? await groupWorkspaceForContext(ctx) : undefined;
  await send(ctx, formatStoredImageList(page, timezone), {
    reply_markup: storedImageListKeyboard(page.images, page.page, page.totalPages, page.offset, pending.id, selecting, workspace?.id) ?? menuBackKeyboard()
  });
  return { page: page.page, pendingId: pending.id };
}

/**
 * Re-sends one saved image from its stored Telegram file id, as a document or photo to match how
 * it was captured, with its action buttons. Lookup is always scoped to the owner's userId.
 */
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
