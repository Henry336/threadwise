export type TelegramAlbumItem<TAttachment, TContext> = {
  messageId: number;
  attachment: TAttachment;
  context: TContext;
  caption?: string;
};

export type TelegramAlbumBatch<TAttachment, TContext> = {
  key: string;
  items: Array<TelegramAlbumItem<TAttachment, TContext>>;
  attachments: TAttachment[];
  context: TContext;
  caption?: string;
};

export type TelegramAlbumAddResult =
  | { status: "accepted"; count: number }
  | { status: "duplicate"; count: number }
  | { status: "blocked" }
  | { status: "overflow" };

type PendingAlbum<TAttachment, TContext> = {
  key: string;
  items: Map<number, TelegramAlbumItem<TAttachment, TContext>>;
  timer?: NodeJS.Timeout;
};

export class TelegramAlbumBatcher<TAttachment, TContext> {
  private readonly pending = new Map<string, PendingAlbum<TAttachment, TContext>>();
  private readonly blocked = new Map<string, NodeJS.Timeout>();

  constructor(private readonly options: {
    settleMs: number;
    maxItems: number;
    blockedMs?: number;
    onFlush: (batch: TelegramAlbumBatch<TAttachment, TContext>) => Promise<void>;
    onError?: (error: unknown, batch: TelegramAlbumBatch<TAttachment, TContext>) => void;
  }) {}

  add(key: string, item: TelegramAlbumItem<TAttachment, TContext>): TelegramAlbumAddResult {
    if (this.blocked.has(key)) return { status: "blocked" };
    const existing = this.pending.get(key);
    if (existing?.items.has(item.messageId)) {
      return { status: "duplicate", count: existing.items.size };
    }
    if (existing && existing.items.size >= this.options.maxItems) {
      this.block(key);
      return { status: "overflow" };
    }

    const album: PendingAlbum<TAttachment, TContext> = existing ?? {
      key,
      items: new Map()
    };
    if (album.timer) clearTimeout(album.timer);
    album.items.set(item.messageId, item);
    album.timer = setTimeout(() => {
      void this.flush(key).catch((error) => {
        const batch = this.toBatch(album);
        this.options.onError?.(error, batch);
      });
    }, this.options.settleMs);
    this.pending.set(key, album);
    return { status: "accepted", count: album.items.size };
  }

  block(key: string): boolean {
    const newlyBlocked = !this.blocked.has(key);
    const album = this.pending.get(key);
    if (album) {
      if (album.timer) clearTimeout(album.timer);
      this.pending.delete(key);
    }
    const prior = this.blocked.get(key);
    if (prior) clearTimeout(prior);
    const timer = setTimeout(() => this.blocked.delete(key), this.options.blockedMs ?? 30_000);
    this.blocked.set(key, timer);
    return newlyBlocked;
  }

  async flush(key: string): Promise<boolean> {
    const album = this.pending.get(key);
    if (!album) return false;
    if (album.timer) clearTimeout(album.timer);
    this.pending.delete(key);
    await this.options.onFlush(this.toBatch(album));
    return true;
  }

  clear(): void {
    for (const album of this.pending.values()) {
      if (album.timer) clearTimeout(album.timer);
    }
    for (const timer of this.blocked.values()) clearTimeout(timer);
    this.pending.clear();
    this.blocked.clear();
  }

  private toBatch(
    album: PendingAlbum<TAttachment, TContext>
  ): TelegramAlbumBatch<TAttachment, TContext> {
    const items = [...album.items.values()].sort((left, right) => left.messageId - right.messageId);
    const primary = items.find((item) => item.caption?.trim()) ?? items[0];
    if (!primary) throw new Error("Telegram album cannot be empty.");
    return {
      key: album.key,
      items,
      attachments: items.map((item) => item.attachment),
      context: primary.context,
      caption: primary.caption?.trim() || undefined
    };
  }
}
