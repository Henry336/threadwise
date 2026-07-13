import { prisma } from "../db/prisma";
import { bold, code, h } from "../utils/html";
import { formatDateTimeForUser } from "../utils/dates";
import { nextPublicId } from "./publicIds";
import { recordImageCaptionUndo } from "./undo";

const IMAGE_PAGE_SIZE = 10;

export type PendingImageInput = {
  userId: string;
  telegramFileId: string;
  telegramUniqueId?: string;
  mediaKind: "photo" | "document";
  mimeType?: string;
  fileName?: string;
  caption?: string;
  fileSize?: number;
};

export async function createPendingImageUpload(input: PendingImageInput) {
  await prisma.pendingImageUpload.deleteMany({ where: { userId: input.userId, expiresAt: { lte: new Date() } } });
  return prisma.pendingImageUpload.create({
    data: { ...input, expiresAt: new Date(Date.now() + 24 * 60 * 60_000) }
  });
}

export async function findPendingImageUpload(userId: string, id: string) {
  return prisma.pendingImageUpload.findFirstOrThrow({ where: { id, userId, expiresAt: { gt: new Date() } } });
}

export async function discardPendingImageUpload(userId: string, id: string): Promise<void> {
  await prisma.pendingImageUpload.deleteMany({ where: { id, userId } });
}

export async function savePendingImageUpload(userId: string, id: string) {
  const pending = await findPendingImageUpload(userId, id);
  const existing = pending.telegramUniqueId
    ? await prisma.storedImage.findFirst({ where: { userId, telegramUniqueId: pending.telegramUniqueId } })
    : undefined;
  if (existing) {
    await prisma.pendingImageUpload.delete({ where: { id: pending.id } });
    return { image: existing, duplicate: true };
  }
  const publicId = await nextPublicId(userId, "IMG");
  const image = await prisma.$transaction(async (tx) => {
    const saved = await tx.storedImage.create({
      data: {
        userId,
        publicId,
        telegramFileId: pending.telegramFileId,
        telegramUniqueId: pending.telegramUniqueId,
        mediaKind: pending.mediaKind,
        mimeType: pending.mimeType,
        fileName: pending.fileName,
        caption: pending.caption
      }
    });
    await tx.pendingImageUpload.delete({ where: { id: pending.id } });
    return saved;
  });
  return { image, duplicate: false };
}

export async function consumePendingImageUpload(userId: string, id: string) {
  const pending = await findPendingImageUpload(userId, id);
  await prisma.pendingImageUpload.delete({ where: { id: pending.id } });
  return pending;
}

export async function listStoredImages(userId: string, requestedPage = 1) {
  const totalItems = await prisma.storedImage.count({ where: { userId } });
  const totalPages = Math.max(1, Math.ceil(totalItems / IMAGE_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(requestedPage) || 1), totalPages);
  const offset = (page - 1) * IMAGE_PAGE_SIZE;
  const images = await prisma.storedImage.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    skip: offset,
    take: IMAGE_PAGE_SIZE
  });
  return { images, page, totalPages, totalItems, offset };
}

export type StoredImageSearchScope = "all" | "caption" | "text";

export async function createStoredImageSearch(userId: string, query: string, scope: StoredImageSearchScope = "all") {
  return prisma.pendingSearch.create({
    data: { userId, query: query.trim(), kinds: ["image", scope], label: `images:${scope}`, expiresAt: new Date(Date.now() + 30 * 60_000) }
  });
}

export async function findStoredImageSearch(userId: string, id: string) {
  return prisma.pendingSearch.findFirstOrThrow({
    where: { id, userId, kinds: { has: "image" }, expiresAt: { gt: new Date() } }
  });
}

export async function searchStoredImages(userId: string, query: string, requestedPage = 1, scope: StoredImageSearchScope = "all") {
  const normalized = query.trim();
  const fields = scope === "caption"
    ? [{ caption: { contains: normalized, mode: "insensitive" as const } }]
    : scope === "text"
      ? [{ ocrText: { contains: normalized, mode: "insensitive" as const } }]
      : [
          { caption: { contains: normalized, mode: "insensitive" as const } },
          { fileName: { contains: normalized, mode: "insensitive" as const } },
          { ocrText: { contains: normalized, mode: "insensitive" as const } }
        ];
  const where = {
    userId,
    OR: fields
  };
  const totalItems = await prisma.storedImage.count({ where });
  const totalPages = Math.max(1, Math.ceil(totalItems / IMAGE_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(requestedPage) || 1), totalPages);
  const offset = (page - 1) * IMAGE_PAGE_SIZE;
  const images = await prisma.storedImage.findMany({ where, orderBy: { createdAt: "desc" }, skip: offset, take: IMAGE_PAGE_SIZE });
  return { images, page, totalPages, totalItems, offset, query: normalized, scope };
}

export async function findStoredImageReference(userId: string, reference: string) {
  const normalized = reference.trim();
  const activeIndex = Number(normalized);
  if (Number.isInteger(activeIndex) && activeIndex > 0) {
    const images = await prisma.storedImage.findMany({
      where: { userId }, orderBy: { createdAt: "desc" }, skip: activeIndex - 1, take: 1
    });
    if (!images[0]) throw new Error(`No saved image numbered ${activeIndex}. Run /images to see your images.`);
    return images[0];
  }
  return prisma.storedImage.findFirstOrThrow({ where: { userId, publicId: normalized.toUpperCase() } });
}

export async function findStoredImageById(userId: string, id: string) {
  return prisma.storedImage.findFirstOrThrow({ where: { id, userId } });
}

export async function updateStoredImageCaption(userId: string, reference: string, caption: string) {
  const image = await findStoredImageReference(userId, reference);
  const nextCaption = caption.trim();
  if (!nextCaption) throw new Error("The caption cannot be empty.");
  return prisma.$transaction(async (tx) => {
    await recordImageCaptionUndo(tx, userId, image, image.caption);
    return tx.storedImage.update({ where: { id: image.id }, data: { caption: nextCaption } });
  });
}

export async function updateStoredImageOcr(userId: string, id: string, text: string, confidence: number) {
  return prisma.storedImage.updateMany({ where: { id, userId }, data: { ocrText: text, ocrConfidence: confidence } });
}

export async function deleteStoredImage(userId: string, id: string) {
  const image = await findStoredImageById(userId, id);
  await prisma.storedImage.delete({ where: { id: image.id } });
  return image;
}

export function formatStoredImageSaved(image: { publicId: string; caption?: string | null }, duplicate = false): string {
  return [
    bold(duplicate ? "🖼️ Image already saved" : "✅ Image saved"),
    image.caption ? h(image.caption) : "Stored through Telegram's reusable file reference.",
    `${bold("Image ID:")} ${code(image.publicId)}`,
    `Open it later with ${code(`/image ${image.publicId}`)} or browse ${code("/images")}.`
  ].join("\n");
}

export function formatStoredImageList(page: Awaited<ReturnType<typeof listStoredImages>> | Awaited<ReturnType<typeof searchStoredImages>>, timezone = "UTC"): string {
  const query = "query" in page ? page.query : undefined;
  if (!page.images.length) return query ? `No saved images match “${query}”. Try a shorter caption or OCR phrase.` : "No saved images yet. Send a photo and tap Save image.";
  return [
    page.totalPages > 1
      ? `${bold(query ? `🔎 Images matching “${query}”` : "🖼️ Saved images")} · Page ${page.page}/${page.totalPages}`
      : bold(query ? `🔎 Images matching “${query}”` : "🖼️ Saved images"),
    "",
    ...page.images.map((image, index) => [
      `${page.offset + index + 1}. ${bold(image.caption || image.fileName || "Saved image")}`,
      `${bold("Image ID:")} ${code(image.publicId)}`,
      `${bold("Saved:")} ${h(formatDateTimeForUser(image.createdAt, timezone))}`
    ].join("\n"))
  ].join("\n\n");
}
