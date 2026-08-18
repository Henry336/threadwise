import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const tracked = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const ignored = /^(?:package-lock\.json|public\/|dist\/|scripts\/scan-tracked-secrets\.mjs$)|\.(?:png|jpe?g|webp|gif|ico|woff2?|pdf)$/iu;
const signatures = [
  { name: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u },
  { name: "OpenAI API key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/u },
  { name: "GitHub token", pattern: /\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/u },
  { name: "Telegram bot token", pattern: /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/u },
  { name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/u },
];

const findings = [];
for (const file of tracked) {
  if (ignored.test(file)) continue;
  let text;
  try { text = readFileSync(file, "utf8"); } catch { continue; }
  if (text.length > 2_000_000 || text.includes("\0")) continue;
  const scanText = text
    .replace(/"-----BEGIN PRIVATE KEY-----\\\\n\.\.\.\\\\n-----END PRIVATE KEY-----"/gu, "")
    .replace(/^.*name: "private key".*$/gmu, "");
  for (const signature of signatures) {
    if (signature.pattern.test(scanText)) findings.push(`${file}: possible ${signature.name}`);
  }
}

if (findings.length) {
  console.error(`Potential secrets found in tracked files:\n${findings.join("\n")}`);
  process.exit(1);
}
console.log(`Secret scan passed (${tracked.length} tracked files checked).`);
