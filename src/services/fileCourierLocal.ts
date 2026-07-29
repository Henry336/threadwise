import { execFile } from "node:child_process";
import {
  constants,
  createReadStream,
  type BigIntStats
} from "node:fs";
import {
  copyFile,
  lstat,
  mkdtemp,
  opendir,
  realpath,
  rm
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type LocalFileMetadata = {
  absolutePath: string;
  fileName: string;
  parentPath: string;
  sizeBytes: number;
  modifiedAt: string;
  identityKey: string;
  mimeType?: string;
  fileType: string;
};

export type LocalFileSnapshot = {
  path: string;
  metadata: LocalFileMetadata;
  stream: () => ReturnType<typeof createReadStream>;
  verifyUnchanged: () => Promise<void>;
  cleanup: () => Promise<void>;
};

export function parseFileRoots(raw: string | undefined, cwd = process.cwd()): string[] {
  if (!raw?.trim()) return [];
  const seen = new Set<string>();
  const roots: string[] = [];
  for (const value of raw.split(";").map((item) => item.trim()).filter(Boolean)) {
    if (isDevicePath(value)) {
      throw new Error(`Device paths are not allowed in THREADWISE_FILE_ROOTS: ${value}`);
    }
    const root = resolve(cwd, value);
    const key = process.platform === "win32" ? root.toLowerCase() : root;
    if (!seen.has(key)) {
      seen.add(key);
      roots.push(root);
    }
  }
  return roots;
}

export function isDevicePath(value: string): boolean {
  const normalized = value.replace(/\//g, "\\");
  return /^(?:\\\\[.?]\\|\\\?\?\\)/i.test(normalized);
}

export function isPathWithinRoot(candidate: string, root: string): boolean {
  const relation = relative(root, candidate);
  return relation === "" || (
    relation !== ".."
    && !relation.startsWith(`..${sep}`)
    && !isAbsolute(relation)
  );
}

export async function searchLaptopFiles(input: {
  roots: string[];
  kind: "SEARCH" | "RECENT" | "LOOKUP";
  query?: string;
  take?: number;
  maxBytes: number;
  scanLimit?: number;
}): Promise<LocalFileMetadata[]> {
  const roots = await validatedRoots(input.roots);
  const take = Math.max(1, Math.min(input.take ?? 8, 10));
  if (input.kind === "LOOKUP") {
    if (!input.query) throw new Error("An absolute path is required.");
    return [await validateLocalFile(input.query, roots, input.maxBytes)];
  }

  const indexed = process.platform === "win32"
    ? await indexedWindowsCandidates(roots, input.query, take * 8).catch(() => [])
    : [];
  const candidates = indexed.length > 0
    ? indexed
    : await fallbackCandidates(roots, input.scanLimit ?? 50_000);
  const tokens = searchTokens(input.query);
  const found = new Map<string, LocalFileMetadata>();
  for (const candidate of candidates) {
    if (found.size >= take * 8) break;
    if (tokens.length && !matchesTokens(candidate, tokens)) continue;
    try {
      const metadata = await validateLocalFile(candidate, roots, input.maxBytes);
      const key = process.platform === "win32"
        ? metadata.absolutePath.toLowerCase()
        : metadata.absolutePath;
      found.set(key, metadata);
    } catch {
      // Indexed results can become stale and recursive scans can race file changes.
    }
  }
  return [...found.values()]
    .sort((left, right) => {
      const newest = Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt);
      return newest || left.fileName.localeCompare(right.fileName);
    })
    .slice(0, take);
}

export async function validateConfiguredFileRoots(roots: string[]): Promise<string[]> {
  return validatedRoots(roots);
}

export async function validateLocalFile(
  candidate: string,
  roots: string[],
  maxBytes: number,
  expected?: {
    sizeBytes: number;
    modifiedAt: string;
    identityKey: string;
  }
): Promise<LocalFileMetadata> {
  if (!candidate || isDevicePath(candidate) || !isAbsolute(candidate)) {
    throw new Error("Only ordinary absolute file paths are allowed.");
  }
  const resolved = resolve(candidate);
  const root = roots.find((entry) => isPathWithinRoot(resolved, entry));
  if (!root) throw new Error("The requested file is outside THREADWISE_FILE_ROOTS.");
  await assertNoReparseComponents(root, resolved);
  const canonical = await realpath(resolved);
  const canonicalRoot = await realpath(root);
  if (!isPathWithinRoot(canonical, canonicalRoot)) {
    throw new Error("The requested file escapes its configured root.");
  }
  const stats = await lstat(canonical, { bigint: true });
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error("Directories, links, and non-file device objects cannot be sent.");
  }
  const sizeBytes = safeStatNumber(stats.size, "file size");
  if (sizeBytes > maxBytes) {
    throw new Error(`The file is larger than the configured ${formatBytes(maxBytes)} limit.`);
  }
  const metadata = metadataFromStats(canonical, stats);
  if (expected && (
    metadata.sizeBytes !== expected.sizeBytes
    || metadata.modifiedAt !== expected.modifiedAt
    || metadata.identityKey !== expected.identityKey
  )) {
    throw new Error("The file changed after it was selected. Search again before sending it.");
  }
  return metadata;
}

export async function createSafeFileSnapshot(input: {
  path: string;
  roots: string[];
  maxBytes: number;
  expected: {
    sizeBytes: number;
    modifiedAt: string;
    identityKey: string;
  };
}): Promise<LocalFileSnapshot> {
  const roots = await validatedRoots(input.roots);
  const before = await validateLocalFile(input.path, roots, input.maxBytes, input.expected);
  const directory = await mkdtemp(join(tmpdir(), "threadwise-file-courier-"));
  const snapshotPath = join(directory, safeSnapshotName(before.fileName));
  try {
    await copyFile(before.absolutePath, snapshotPath, constants.COPYFILE_EXCL);
    const after = await validateLocalFile(before.absolutePath, roots, input.maxBytes, input.expected);
    if (!sameFileVersion(before, after)) {
      throw new Error("The file changed while Threadwise was preparing it.");
    }
    const snapshotStats = await lstat(snapshotPath, { bigint: true });
    if (!snapshotStats.isFile() || safeStatNumber(snapshotStats.size, "snapshot size") !== before.sizeBytes) {
      throw new Error("The safe transfer snapshot is incomplete.");
    }
    const snapshotIdentity = identityFromStats(snapshotStats);
    return {
      path: snapshotPath,
      metadata: before,
      stream: () => createReadStream(snapshotPath),
      verifyUnchanged: async () => {
        const current = await lstat(snapshotPath, { bigint: true });
        if (!current.isFile() || identityFromStats(current) !== snapshotIdentity) {
          throw new Error("The file changed during transfer.");
        }
      },
      cleanup: async () => {
        await rm(directory, { recursive: true, force: true });
      }
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export function sameFileVersion(left: LocalFileMetadata, right: LocalFileMetadata): boolean {
  return left.absolutePath === right.absolutePath
    && left.sizeBytes === right.sizeBytes
    && left.modifiedAt === right.modifiedAt
    && left.identityKey === right.identityKey;
}

export function fileTypeForName(fileName: string): { fileType: string; mimeType?: string } {
  const extension = extname(fileName).toLowerCase();
  const known: Record<string, [string, string]> = {
    ".jpg": ["Image", "image/jpeg"],
    ".jpeg": ["Image", "image/jpeg"],
    ".png": ["Image", "image/png"],
    ".gif": ["Image", "image/gif"],
    ".webp": ["Image", "image/webp"],
    ".mp4": ["Video", "video/mp4"],
    ".mov": ["Video", "video/quicktime"],
    ".mkv": ["Video", "video/x-matroska"],
    ".pdf": ["PDF", "application/pdf"],
    ".xlsx": ["Excel workbook", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ".xls": ["Excel workbook", "application/vnd.ms-excel"],
    ".docx": ["Word document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ".doc": ["Word document", "application/msword"],
    ".zip": ["Archive", "application/zip"],
    ".7z": ["Archive", "application/x-7z-compressed"],
    ".rar": ["Archive", "application/vnd.rar"],
    ".mp3": ["Audio", "audio/mpeg"],
    ".m4a": ["Audio", "audio/mp4"],
    ".wav": ["Audio", "audio/wav"],
    ".ogg": ["Audio", "audio/ogg"]
  };
  const match = known[extension];
  return match
    ? { fileType: match[0], mimeType: match[1] }
    : { fileType: extension ? `${extension.slice(1).toUpperCase()} file` : "File" };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 ** 2) return `${(bytes / 1_024).toFixed(1)} KB`;
  if (bytes < 1_024 ** 3) return `${(bytes / 1_024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1_024 ** 3).toFixed(1)} GB`;
}

async function validatedRoots(roots: string[]): Promise<string[]> {
  if (!roots.length) {
    throw new Error("THREADWISE_FILE_ROOTS is empty. Configure at least one explicit laptop folder.");
  }
  const validated: string[] = [];
  for (const root of roots) {
    if (isDevicePath(root) || !isAbsolute(root)) throw new Error(`Invalid file root: ${root}`);
    const resolved = resolve(root);
    const stats = await lstat(resolved);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`File root must be an ordinary directory, not a reparse point: ${resolved}`);
    }
    validated.push(await realpath(resolved));
  }
  return validated;
}

async function assertNoReparseComponents(root: string, target: string): Promise<void> {
  const relation = relative(root, target);
  if (relation === "" || relation.startsWith("..") || isAbsolute(relation)) {
    if (relation === "") throw new Error("A directory cannot be sent.");
    throw new Error("The requested file is outside its configured root.");
  }
  let current = root;
  const rootStats = await lstat(root);
  if (rootStats.isSymbolicLink()) throw new Error("Reparse-point roots are not allowed.");
  for (const segment of relation.split(sep)) {
    current = join(current, segment);
    const stats = await lstat(current);
    if (stats.isSymbolicLink()) {
      throw new Error("Files reached through symlinks or reparse points cannot be sent.");
    }
  }
}

async function fallbackCandidates(roots: string[], scanLimit: number): Promise<string[]> {
  const files: string[] = [];
  const directories = [...roots];
  let scanned = 0;
  while (directories.length && scanned < scanLimit) {
    const directory = directories.shift()!;
    let entries;
    try {
      entries = await opendir(directory);
    } catch {
      continue;
    }
    for await (const entry of entries) {
      scanned += 1;
      if (scanned > scanLimit) break;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) directories.push(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  return files;
}

async function indexedWindowsCandidates(roots: string[], query: string | undefined, take: number): Promise<string[]> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$roots = ConvertFrom-Json $env:THREADWISE_FILE_SEARCH_ROOTS",
    "$tokens = ConvertFrom-Json $env:THREADWISE_FILE_SEARCH_TOKENS",
    "$connection = New-Object -ComObject ADODB.Connection",
    "$connection.Open('Provider=Search.CollatorDSO;Extended Properties=\"Application=Windows\";')",
    "$scopes = @($roots | ForEach-Object { \"SCOPE='file:\" + $_.Replace('\\','/').Replace(\"'\",\"''\") + \"'\" })",
    "$where = '(' + ($scopes -join ' OR ') + ')'",
    "foreach ($token in $tokens) {",
    "  $safe = $token.Replace(\"'\",\"''\").Replace('\"','')",
    "  $where += \" AND CONTAINS(System.FileName, '\"\"$safe*\"\"')\"",
    "}",
    `$sql = "SELECT TOP ${Math.max(10, Math.min(take, 200))} System.ItemPathDisplay FROM SYSTEMINDEX WHERE $where ORDER BY System.DateModified DESC"`,
    "$rows = @()",
    "$recordset = $connection.Execute($sql)",
    "while (-not $recordset.EOF) {",
    "  $path = [string]$recordset.Fields.Item('System.ItemPathDisplay').Value",
    "  if ($path) { $rows += $path }",
    "  $recordset.MoveNext()",
    "}",
    "$recordset.Close()",
    "$connection.Close()",
    "$rows | ConvertTo-Json -Compress"
  ].join("\n");
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script
  ], {
    env: {
      ...process.env,
      THREADWISE_FILE_SEARCH_ROOTS: JSON.stringify(roots),
      THREADWISE_FILE_SEARCH_TOKENS: JSON.stringify(searchTokens(query))
    },
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 2 * 1024 * 1024
  });
  if (!stdout.trim()) return [];
  const parsed = JSON.parse(stdout) as string | string[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

function searchTokens(query: string | undefined): string[] {
  return (query?.toLowerCase().match(/[a-z0-9][a-z0-9_-]*/g) ?? [])
    .filter((token) => !["file", "document", "from", "laptop", "the", "latest", "newest", "recent"].includes(token))
    .slice(0, 8);
}

function matchesTokens(path: string, tokens: string[]): boolean {
  const value = path.toLowerCase();
  return tokens.every((token) => value.includes(token));
}

function metadataFromStats(path: string, stats: BigIntStats): LocalFileMetadata {
  const type = fileTypeForName(path);
  return {
    absolutePath: path,
    fileName: basename(path),
    parentPath: dirname(path),
    sizeBytes: safeStatNumber(stats.size, "file size"),
    modifiedAt: new Date(safeStatNumber(stats.mtimeNs / 1_000_000n, "modified time")).toISOString(),
    identityKey: identityFromStats(stats),
    mimeType: type.mimeType,
    fileType: type.fileType
  };
}

function identityFromStats(stats: BigIntStats): string {
  return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}`;
}

function safeStatNumber(value: bigint, label: string): number {
  const converted = Number(value);
  if (!Number.isSafeInteger(converted) || converted < 0) {
    throw new Error(`The ${label} cannot be represented safely.`);
  }
  return converted;
}

function safeSnapshotName(fileName: string): string {
  const cleaned = fileName.replace(/[^a-z0-9._-]+/gi, "_").replace(/^\.+/, "").slice(0, 180);
  return cleaned || "file";
}
