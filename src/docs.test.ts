import { afterEach, describe, expect, it, vi } from "vitest";
import { createDocsSource, isSafeDocSlug, parseLlmsFull, searchDocs } from "./docs.js";

const SAMPLE = `# 2Pay Documentation (full text)

> intro

# Part: Developers

---

Source: https://docs.2pay.gg/dev/a

# A

Alpha body about webhook delivery.

---

Source: https://docs.2pay.gg/dev/b

# B

Beta body.
`;

describe("parseLlmsFull", () => {
  it("parses pages with url, title and body", () => {
    const pages = parseLlmsFull(SAMPLE);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatchObject({ url: "https://docs.2pay.gg/dev/a", title: "A" });
    expect(pages[0]!.body).toContain("Alpha body");
    expect(pages[1]).toMatchObject({ url: "https://docs.2pay.gg/dev/b", title: "B" });
  });
});

describe("searchDocs", () => {
  const pages = [
    { url: "u1", title: "Webhooks", body: "the signature is verified with an HMAC" },
    { url: "u2", title: "Webhook signature", body: "short" },
    { url: "u3", title: "Other", body: "nothing here" },
  ];

  it("ranks title hits above body hits", () => {
    const r = searchDocs(pages, "webhook signature");
    expect(r[0]!.url).toBe("u2");
    expect(r.map((x) => x.url)).not.toContain("u3");
  });

  it("limits results and bounds the excerpt", () => {
    const long = { url: "l", title: "L", body: "x".repeat(1000) + " needle " + "y".repeat(1000) };
    const r = searchDocs([long], "needle", 1);
    expect(r).toHaveLength(1);
    expect(r[0]!.excerpt.length).toBeLessThanOrEqual(400);
    expect(r[0]!.excerpt).toContain("needle");
  });

  it("returns nothing for an empty query", () => {
    expect(searchDocs(pages, "   ")).toEqual([]);
  });
});

describe("isSafeDocSlug", () => {
  it("accepts plain slugs", () => {
    expect(isSafeDocSlug("dev/webhooks/events")).toBe(true);
    expect(isSafeDocSlug("creators/getting-paid/payouts")).toBe(true);
  });
  it("rejects traversal, urls and empty", () => {
    for (const s of ["../x", "https://evil.example", "dev/../../etc", "", "etc/passwd", "dev/A", "dev/a.b", "dev/", "/dev/a", "anything/else", "Dev/X_Y"]) {
      expect(isSafeDocSlug(s)).toBe(false);
    }
  });
});

describe("createDocsSource", () => {
  afterEach(() => vi.useRealTimers());


  it("caches within ttl, refetches after, and does not cache failures", async () => {
    let t = 0;
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("nope", { status: 500 }))
      .mockImplementation(async () => new Response(SAMPLE, { status: 200 }));
    const src = createDocsSource({ docsUrl: "https://docs.2pay.gg", fetchImpl, ttlMs: 1000, now: () => t });

    await expect(src.pages()).rejects.toThrow();
    expect((await src.pages()).length).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://docs.2pay.gg/llms-full.txt");

    t = 500;
    await src.pages();
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    t = 1500;
    await src.pages();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("page() fetches the md path", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => new Response("# Hi"));
    const src = createDocsSource({ docsUrl: "https://docs.2pay.gg", fetchImpl });
    expect(await src.page("dev/a")).toBe("# Hi");
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://docs.2pay.gg/md/dev/a");
  });

  it("page() rejects an unsafe slug without fetching", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const src = createDocsSource({ docsUrl: "https://docs.2pay.gg", fetchImpl });
    await expect(src.page("../x")).rejects.toThrow(/Unsafe/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects when fetch never resolves", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(
      (_u, init) =>
        new Promise((_res, rej) => {
          init?.signal?.addEventListener("abort", () => rej(new Error("aborted")));
        }),
    );
    const src = createDocsSource({ docsUrl: "https://docs.2pay.gg", fetchImpl });
    const p = expect(src.pages()).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10_001);
    await p;
  });

  it("honors an injected timeoutMs", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    const src = createDocsSource({ docsUrl: "https://docs.2pay.gg", fetchImpl, timeoutMs: 50 });
    const p = expect(src.page("dev/a")).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(51);
    await p;
  });
});
