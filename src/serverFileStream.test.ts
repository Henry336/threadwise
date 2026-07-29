import { describe, expect, it } from "vitest";
import { exactLengthStream } from "./server";

describe("file courier server streaming", () => {
  it("streams exact-length content without buffering it in PostgreSQL or a server file", async () => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of exactLengthStream(source(["abc", "def"]), 6, 10)) chunks.push(chunk);
    expect(Buffer.concat(chunks)).toEqual(Buffer.from("abcdef"));
  });

  it("rejects changed, truncated, and oversized transfers", async () => {
    await expect(consume(exactLengthStream(source(["abc"]), 4, 10))).rejects.toThrow(/ended/i);
    await expect(consume(exactLengthStream(source(["abcde"]), 4, 10))).rejects.toThrow(/more bytes/i);
    await expect(consume(exactLengthStream(source(["abcde"]), 5, 4))).rejects.toThrow(/more bytes/i);
  });
});

async function* source(values: string[]): AsyncGenerator<Uint8Array> {
  for (const value of values) yield Buffer.from(value);
}

async function consume(source: AsyncIterable<Uint8Array>): Promise<void> {
  for await (const _chunk of source) {
    // Consume the validation stream.
  }
}
