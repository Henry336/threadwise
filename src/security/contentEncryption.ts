import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const PREFIX = "twenc:v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ENCRYPTED_VALUE_PATTERN = /^twenc:v1:(Task|Note|Idea|StoredImage|StudyResource|StudyResourceRevision|GeminiIdeaJob|GeminiStudyAnalysisJob|StudyNoteEditSuggestion|StudyCanvasMaterial):[A-Za-z][A-Za-z0-9]*:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{16,}:[A-Za-z0-9_-]*$/u;

let cachedEnvironmentCipher: { signature: string; cipher: ContentCipher } | undefined;

export type ContentModel =
  | "Task"
  | "Note"
  | "Idea"
  | "StoredImage"
  | "StudyResource"
  | "StudyResourceRevision"
  | "GeminiIdeaJob"
  | "GeminiStudyAnalysisJob"
  | "StudyNoteEditSuggestion"
  | "StudyCanvasMaterial";
export type ContentEncryptionMode = "off" | "write";

type ModelPolicy = {
  encrypted: readonly string[];
  searchable: readonly string[];
};

export const CONTENT_POLICIES: Record<ContentModel, ModelPolicy> = {
  Task: { encrypted: ["title", "description", "sourceText"], searchable: ["title", "description", "sourceText"] },
  Note: { encrypted: ["title", "body", "summary", "sourceText"], searchable: ["title", "body", "summary", "sourceText"] },
  Idea: { encrypted: ["title", "concept", "problem", "targetUser", "sourceText", "marketNotes"], searchable: ["title", "concept", "problem", "targetUser", "sourceText", "marketNotes"] },
  StoredImage: { encrypted: ["fileName", "caption", "ocrText"], searchable: ["fileName", "caption", "ocrText"] },
  StudyResource: { encrypted: ["title", "body", "url", "fileName", "caption", "ocrText"], searchable: ["title", "body", "url", "fileName", "caption", "ocrText"] },
  StudyResourceRevision: { encrypted: ["title", "body"], searchable: [] },
  GeminiIdeaJob: { encrypted: ["prompt", "finalResponse"], searchable: [] },
  GeminiStudyAnalysisJob: { encrypted: ["evidenceCiphertext", "promptCiphertext", "resultCiphertext"], searchable: [] },
  StudyNoteEditSuggestion: { encrypted: ["originalBody", "suggestedBody", "rationale", "appliedBody"], searchable: [] },
  StudyCanvasMaterial: { encrypted: ["extractedText"], searchable: [] },
};

export class ContentCipher {
  readonly mode: ContentEncryptionMode;
  private readonly encryptionKey?: Buffer;
  private readonly searchKey?: Buffer;

  constructor(input: { mode?: ContentEncryptionMode; key?: string }) {
    this.mode = input.mode ?? "off";
    if (!input.key) {
      if (this.mode === "write") throw new Error("CONTENT_ENCRYPTION_KEY is required when CONTENT_ENCRYPTION_MODE=write.");
      return;
    }
    const master = decodeMasterKey(input.key);
    this.encryptionKey = deriveKey(master, "threadwise-content-encryption-v1");
    this.searchKey = deriveKey(master, "threadwise-content-search-v1");
  }

  get available(): boolean {
    return Boolean(this.encryptionKey && this.searchKey);
  }

  encrypt(model: ContentModel, field: string, value: string): string {
    if (this.mode !== "write" || !this.encryptionKey || isEncryptedContent(value)) return value;
    const iv = randomBytes(IV_BYTES);
    const aad = Buffer.from(`${PREFIX}:${model}:${field}`, "utf8");
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(aad);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return [PREFIX, model, field, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(":");
  }

  decrypt(value: string): string {
    if (!isEncryptedContent(value)) return value;
    if (!this.encryptionKey) throw new Error("Encrypted Threadwise content was found, but CONTENT_ENCRYPTION_KEY is unavailable.");
    const parts = value.split(":");
    if (parts.length !== 7) throw new Error("Encrypted Threadwise content has an unsupported format.");
    const [, , model, field, ivValue, tagValue, ciphertextValue] = parts;
    const iv = Buffer.from(ivValue!, "base64url");
    const tag = Buffer.from(tagValue!, "base64url");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error("Encrypted Threadwise content is malformed.");
    const aad = Buffer.from(`${PREFIX}:${model}:${field}`, "utf8");
    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(ciphertextValue!, "base64url")), decipher.final()]).toString("utf8");
  }

  searchTokens(model: ContentModel, values: Array<{ field: string; value: string | null | undefined }>): string[] {
    if (!this.searchKey) return [];
    const tokens = new Set<string>();
    for (const entry of values) {
      for (const term of searchableTerms(entry.value ?? "")) {
        tokens.add(createHmac("sha256", this.searchKey).update(`${model}:${entry.field}:${term}`).digest("base64url").slice(0, 24));
      }
    }
    return [...tokens];
  }

  queryTokens(model: ContentModel, field: string, query: string): string[] {
    if (!this.searchKey) return [];
    return queryTerms(query).map((term) => createHmac("sha256", this.searchKey!).update(`${model}:${field}:${term}`).digest("base64url").slice(0, 24));
  }
}

export function contentCipherFromEnvironment(): ContentCipher {
  const configuredMode = process.env.CONTENT_ENCRYPTION_MODE?.trim().toLowerCase();
  const mode: ContentEncryptionMode = configuredMode === "write" ? "write" : "off";
  const key = process.env.CONTENT_ENCRYPTION_KEY?.trim() || undefined;
  const signature = `${mode}:${key ?? ""}`;
  if (cachedEnvironmentCipher?.signature === signature) return cachedEnvironmentCipher.cipher;
  const cipher = new ContentCipher({ mode, key });
  cachedEnvironmentCipher = { signature, cipher };
  return cipher;
}

export function isEncryptedContent(value: unknown): value is string {
  return typeof value === "string" && ENCRYPTED_VALUE_PATTERN.test(value);
}

export function decryptContentTree<T>(value: T, cipher: ContentCipher): T {
  if (typeof value === "string") return cipher.decrypt(value) as T;
  if (Array.isArray(value)) return value.map((item) => decryptContentTree(item, cipher)) as T;
  if (!value || typeof value !== "object" || value instanceof Date || Buffer.isBuffer(value)) return value;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    (value as Record<string, unknown>)[key] = decryptContentTree(child, cipher);
  }
  return value;
}

export function prepareContentWrite(model: string | undefined, operation: string, args: unknown, cipher: ContentCipher): unknown {
  if (!model || !(model in CONTENT_POLICIES) || !args || typeof args !== "object") return args;
  if (!operation.startsWith("create") && !operation.startsWith("update") && operation !== "upsert") return args;
  const typedModel = model as ContentModel;
  const container = args as Record<string, unknown>;
  if (operation === "upsert") {
    if (container.create) container.create = prepareData(typedModel, container.create, "create", cipher);
    if (container.update) container.update = prepareData(typedModel, container.update, "update", cipher);
  } else if (container.data) {
    container.data = prepareData(typedModel, container.data, operation.startsWith("create") ? "create" : "update", cipher);
  }
  return args;
}

export function encryptedSearchClause(
  model: ContentModel,
  query: string,
  fields: readonly string[] = CONTENT_POLICIES[model].searchable,
): { OR: Array<{ searchTokens: { hasEvery: string[] } }> } | undefined {
  const cipher = contentCipherFromEnvironment();
  const clauses = fields
    .map((field) => cipher.queryTokens(model, field, query))
    .filter((tokens) => tokens.length)
    .map((tokens) => ({ searchTokens: { hasEvery: tokens } }));
  return clauses.length ? { OR: clauses } : undefined;
}

export function contentMatchesQuery(model: ContentModel, value: Record<string, unknown>, query: string, fields: readonly string[] = CONTENT_POLICIES[model].searchable): boolean {
  const normalized = normalizeSearchText(query);
  if (!normalized) return true;
  return fields.some((field) => typeof value[field] === "string" && normalizeSearchText(value[field] as string).includes(normalized));
}

export function completeSearchableContentUpdate<T extends Record<string, unknown>>(
  model: ContentModel,
  current: object,
  changes: T,
): T {
  const searchable = CONTENT_POLICIES[model].searchable;
  if (!searchable.some((field) => Object.prototype.hasOwnProperty.call(changes, field))) return changes;
  const completed: Record<string, unknown> = { ...changes };
  for (const field of searchable) {
    if (!Object.prototype.hasOwnProperty.call(completed, field)) completed[field] = (current as Record<string, unknown>)[field] ?? null;
  }
  return completed as T;
}

function prepareData(model: ContentModel, input: unknown, kind: "create" | "update", cipher: ContentCipher): unknown {
  if (Array.isArray(input)) return input.map((value) => prepareData(model, value, kind, cipher));
  if (!input || typeof input !== "object") return input;
  // `off` is deliberately inert. A configured key may still decrypt existing
  // ciphertext and build query tokens, but writes change only in explicit
  // `write` mode so adding the secret alone cannot mutate production data.
  if (cipher.mode !== "write") return input;
  const data = input as Record<string, unknown>;
  const policy = CONTENT_POLICIES[model];
  const searchableValues: Array<{ field: string; value: string }> = [];
  const suppliedSearchableFields = new Set<string>();
  for (const field of policy.encrypted) {
    const value = data[field];
    const direct = typeof value === "string" ? value : undefined;
    const setValue = isSetOperation(value) && typeof value.set === "string" ? value.set : undefined;
    const plaintext = direct ?? setValue;
    const explicitlyNull = value === null || (isSetOperation(value) && value.set === null);
    if (policy.searchable.includes(field) && (plaintext !== undefined || explicitlyNull)) suppliedSearchableFields.add(field);
    if (plaintext === undefined) continue;
    const cleartext = isEncryptedContent(plaintext) ? cipher.decrypt(plaintext) : plaintext;
    if (policy.searchable.includes(field)) searchableValues.push({ field, value: cleartext });
    const encrypted = cipher.encrypt(model, field, plaintext);
    if (direct !== undefined) data[field] = encrypted;
    else (value as { set: string }).set = encrypted;
  }
  if (policy.searchable.length) {
    const tokens = cipher.searchTokens(model, searchableValues);
    if (kind === "update" && suppliedSearchableFields.size > 0 && suppliedSearchableFields.size !== policy.searchable.length) {
      throw new Error(`${model} searchable-content updates must supply every protected searchable field so the blind index can be replaced exactly.`);
    }
    if (kind === "create") data.searchTokens = tokens;
    else if (suppliedSearchableFields.size === policy.searchable.length) data.searchTokens = { set: tokens };
  }
  return input;
}

function isSetOperation(value: unknown): value is { set: unknown } {
  return Boolean(value && typeof value === "object" && "set" in value);
}

function searchableTerms(value: string): string[] {
  const normalized = value.normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
  if (!normalized) return [];
  const terms = new Set<string>();
  for (const word of normalized.split(" ")) {
    for (let length = 1; length <= Math.min(2, word.length); length += 1) terms.add(`p:${word.slice(0, length)}`);
    terms.add(`w:${word}`);
  }
  for (let index = 0; index <= normalized.length - 3; index += 1) terms.add(`g:${normalized.slice(index, index + 3)}`);
  return [...terms];
}

function queryTerms(value: string): string[] {
  const normalized = normalizeSearchText(value);
  if (!normalized) return [];
  if (normalized.length < 3 && !normalized.includes(" ")) return [`p:${normalized}`];
  const terms = new Set<string>();
  for (let index = 0; index <= normalized.length - 3; index += 1) terms.add(`g:${normalized.slice(index, index + 3)}`);
  return [...terms];
}

function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

function decodeMasterKey(value: string): Buffer {
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32 || decoded.toString("base64").replace(/=+$/u, "") !== value.replace(/=+$/u, "")) {
    throw new Error("CONTENT_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return decoded;
}

function deriveKey(master: Buffer, purpose: string): Buffer {
  return createHmac("sha256", master).update(purpose).digest();
}
