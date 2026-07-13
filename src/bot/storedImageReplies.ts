import type { Context } from "grammy";
import { findStoredImageById, findStoredImageReference, formatStoredImageList, listStoredImages } from "../services/storedImages";
import { bold, code, HTML_REPLY, replyHtml } from "../utils/html";
import { storedImageListKeyboard } from "./keyboards";

export async function replyStoredImageList(ctx: Context, userId: string, timezone = "UTC", requestedPage = 1): Promise<number> {
  const page = await listStoredImages(userId, requestedPage);
  await replyHtml(ctx, formatStoredImageList(page, timezone), {
    reply_markup: storedImageListKeyboard(page.images, page.page, page.totalPages, page.offset)
  });
  return page.page;
}

export async function replyStoredImage(ctx: Context, userId: string, reference: string, byRowId = false): Promise<void> {
  const image = byRowId ? await findStoredImageById(userId, reference) : await findStoredImageReference(userId, reference);
  const caption = [
    bold(image.caption || image.fileName || "Saved image"),
    `${bold("Image ID:")} ${code(image.publicId)}`
  ].join("\n");
  if (image.mediaKind === "document") {
    await ctx.replyWithDocument(image.telegramFileId, { caption, ...HTML_REPLY });
  } else {
    await ctx.replyWithPhoto(image.telegramFileId, { caption, ...HTML_REPLY });
  }
}
