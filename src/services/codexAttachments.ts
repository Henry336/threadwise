import type { UserInput } from "@openai/codex-sdk";
import { basename } from "node:path";

export function safeCodexAttachmentName(fileName: string, index: number): string {
  const cleaned = basename(fileName)
    .replace(/[^a-z0-9._-]+/gi, "_")
    .replace(/^\.+/, "")
    .slice(0, 160);
  return `${index + 1}-${cleaned || "attachment"}`;
}

export function codexInputWithAttachments(prompt: string, imagePaths: string[], filePaths: string[]): UserInput[] {
  const fileContext = filePaths.length
    ? [
        "",
        "",
        "The user attached the following local files. Inspect them directly as part of this task:",
        ...filePaths.map((path) => `- ${path}`)
      ].join("\n")
    : "";
  return [
    { type: "text", text: `${prompt}${fileContext}` },
    ...imagePaths.map((path) => ({ type: "local_image" as const, path }))
  ];
}
