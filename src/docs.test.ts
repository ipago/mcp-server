import { afterEach, describe, expect, it, vi } from "vitest";
import { createDocsSource, isSafeDocSlug, parseLlmsFull, searchDocs } from "./docs.js";

const SAMPLE = `# iPago Documentation (full text)

> intro

# Part: Developers

---

Source: https://docs.ipago.io/dev/a

# A

Alpha body about webhook delivery.

---

Source: https://docs.ipago.io/dev/b

# B

Beta body.
`;

describe("parseLlmsFull", () => {
  it("parses pages with url, title and body", () => {
    const pages = parseLlmsFull(SAMPLE);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatchObject({ url: "https://docs.ipago.io/dev/a", title: "A" });
    expect(pages[0]!.body).toContain("Alpha body");
    expect(pages[1]).toMatchObject({ url: "https://docs.ipago.io/dev/b", title: "B" });
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
    const src = createDocsSource({ docsUrl: "https://docs.ipago.io", fetchImpl, ttlMs: 1000, now: () => t });

    await expect(src.pages()).rejects.toThrow();
    expect((await src.pages()).length).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://docs.ipago.io/llms-full.txt");

    t = 500;
    await src.pages();
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    t = 1500;
    await src.pages();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("shares one in-flight load between concurrent callers, and retries after a failure", async () => {
    let release!: (r: Response) => void;
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => new Promise<Response>((res) => (release = res)))
      .mockImplementationOnce(async () => new Response("nope", { status: 500 }))
      .mockImplementationOnce(async () => new Response("nope", { status: 500 }))
      .mockImplementation(async () => new Response(SAMPLE, { status: 200 }));
    let t = 0;
    const src = createDocsSource({ docsUrl: "https://docs.ipago.io", fetchImpl, ttlMs: 1000, now: () => t });

    const a = src.pages();
    const b = src.pages();
    release(new Response(SAMPLE, { status: 200 }));
    const [pa, pb] = await Promise.all([a, b]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(pa).toHaveLength(2);
    expect(pb).toBe(pa);

    t = 1500; // expired: two concurrent callers share one failed load
    const fails = await Promise.allSettled([src.pages(), src.pages()]);
    expect(fails.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    await expect(src.pages()).rejects.toThrow(/500/); // not cached: fetches again
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(await src.pages()).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("page() fetches the md path", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => new Response("# Hi"));
    const src = createDocsSource({ docsUrl: "https://docs.ipago.io", fetchImpl });
    expect(await src.page("dev/a")).toBe("# Hi");
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://docs.ipago.io/md/dev/a");
  });

  it("page() rejects an unsafe slug without fetching", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const src = createDocsSource({ docsUrl: "https://docs.ipago.io", fetchImpl });
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
    const src = createDocsSource({ docsUrl: "https://docs.ipago.io", fetchImpl });
    const p = expect(src.pages()).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10_001);
    await p;
  });

  it("honors an injected timeoutMs", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    const src = createDocsSource({ docsUrl: "https://docs.ipago.io", fetchImpl, timeoutMs: 50 });
    const p = expect(src.page("dev/a")).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(51);
    await p;
  });
});
