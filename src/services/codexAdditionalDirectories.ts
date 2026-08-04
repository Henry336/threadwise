import { realpath, stat } from "node:fs/promises";
import { dirname, parse, resolve, win32 } from "node:path";

export function quotedWindowsPaths(prompt: string): string[] {
  const paths: string[] = [];
  const pattern = /(["'])([a-z]:[\\/][^"'\r\n]+)\1/gi;
  for (const match of prompt.matchAll(pattern)) {
    if (match[2]) paths.push(win32.normalize(match[2]));
  }
  return [...new Set(paths.map((path) => path.toLowerCase()))]
    .map((key) => paths.find((path) => path.toLowerCase() === key)!);
}

export function windowsSandboxDirectoryCandidates(
  configuredRoots: readonly string[],
  prompt: string
): string[] {
  const roots = configuredRoots.map((root) => win32.resolve(root));
  const explicitRoots = roots.filter((root) => !isWindowsVolumeRoot(root));
  const promptPaths = quotedWindowsPaths(prompt).filter((candidate) =>
    !isWindowsVolumeRoot(candidate)
    && roots.some((root) => isWindowsPathWithin(root, candidate))
  );
  return deduplicateWindowsPaths([...explicitRoots, ...promptPaths]);
}

export async function resolveCodexAdditionalDirectories(
  configuredRoots: readonly string[],
  prompt: string,
  platform = process.platform
): Promise<string[]> {
  const candidates = platform === "win32"
    ? windowsSandboxDirectoryCandidates(configuredRoots, prompt)
    : configuredRoots.map((root) => resolve(root));
  const directories: string[] = [];
  for (const candidate of candidates) {
    const directory = await existingDirectory(candidate);
    const canonical = await realpath(directory);
    if (!directories.some((item) => samePath(item, canonical, platform))) directories.push(canonical);
  }
  return directories;
}

export function isWindowsVolumeRoot(path: string): boolean {
  const normalized = win32.resolve(path);
  return normalized.toLowerCase() === win32.parse(normalized).root.toLowerCase();
}

export function isWindowsPathWithin(root: string, candidate: string): boolean {
  const relative = win32.relative(win32.resolve(root), win32.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !win32.isAbsolute(relative));
}

async function existingDirectory(candidate: string): Promise<string> {
  let current = resolve(candidate);
  while (true) {
    try {
      const metadata = await stat(current);
      return metadata.isDirectory() ? current : dirname(current);
    } catch {
      const parent = dirname(current);
      if (parent === current) throw new Error(`No existing parent directory was found for ${candidate}.`);
      current = parent;
    }
  }
}

function deduplicateWindowsPaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  return paths.filter((path) => {
    const key = win32.resolve(path).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function samePath(left: string, right: string, platform: string): boolean {
  return platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}
