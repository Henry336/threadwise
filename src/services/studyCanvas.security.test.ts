import { describe, expect, it, vi } from "vitest";
import { fetchCanvasApiResponse, requireCanvasApiUrl } from "./studyCanvas";

const base = "https://canvas.example.edu/api/v1";

describe("Canvas credential boundary", () => {
  it("accepts only URLs within the configured Canvas API origin and path", () => {
    expect(requireCanvasApiUrl("courses?page=2", base)).toBe(
      "https://canvas.example.edu/api/v1/courses?page=2",
    );
    expect(requireCanvasApiUrl("https://canvas.example.edu/api/v1/courses?page=2", base)).toBe(
      "https://canvas.example.edu/api/v1/courses?page=2",
    );
  });

  it.each([
    "https://attacker.example/api/v1/courses?page=2",
    "https://canvas.example.edu.evil.example/api/v1/courses?page=2",
    "https://user:password@canvas.example.edu/api/v1/courses?page=2",
    "https://canvas.example.edu/api/v10/courses?page=2",
    "https://canvas.example.edu/other/courses?page=2",
  ])("rejects an untrusted pagination or material URL before fetching: %s", async (url) => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(fetchCanvasApiResponse(url, "fake-test-token", fetcher)).rejects.toThrow(
      "outside the configured Canvas API boundary",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("attaches the token only to a validated URL and disables automatic redirects", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("[]", { status: 200 }));

    await fetchCanvasApiResponse(
      "https://canvas.nus.edu.sg/api/v1/courses?page=2",
      "fake-test-token",
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      "https://canvas.nus.edu.sg/api/v1/courses?page=2",
      expect.objectContaining({
        headers: { Authorization: "Bearer fake-test-token", Accept: "application/json" },
        redirect: "manual",
      }),
    );
  });

  it("does not follow even a same-origin redirect with the bearer token", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: "https://attacker.example/collect" },
    }));

    await expect(fetchCanvasApiResponse(
      "https://canvas.nus.edu.sg/api/v1/courses",
      "fake-test-token",
      fetcher,
    )).rejects.toThrow("refused to forward the access token");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
