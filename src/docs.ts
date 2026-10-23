export type DocPage = { url: string; title: string; body: string };
export type DocHit = { url: string; title: string; excerpt: string; score: number };

const EXCERPT_MAX = 400;

/** Parses the llms-full.txt format: pages separated by `---`, `Source: <url>`, then `# Title` and the body. */
export function parseLlmsFull(text: string): DocPage[] {
  const pages: DocPage[] = [];
  const chunks = text.replace(/\r\n/g, "\n").split(/^---\n\nSource: /m).slice(1);
  for (const chunk of chunks) {
    const nl = chunk.indexOf("\n");
    const url = (nl === -1 ? chunk : chunk.slice(0, nl)).trim();
    const rest = nl === -1 ? "" : chunk.slice(nl + 1).replace(/^\n+/, "");
    const m = /^# (.*)\n?/.exec(rest);
    const title = m ? m[1]!.trim() : url;
    const body = (m ? rest.slice(m[0].length) : rest).trim();
    if (url) pages.push({ url, title, body });
  }
  return pages;
}

function excerptAround(body: string, terms: string[]): string {
  const lower = body.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  if (at === -1) return body.slice(0, EXCERPT_MAX).trim();
  const start = Math.max(0, at - 100);
  return body.slice(start, start + EXCERPT_MAX).trim();
}

function countOccurrences(haystack: string, needle: string): number {
  let n = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) n++;
  return n;
}

/** Scores per term: a title hit weighs 3, each body occurrence 1. */
export function searchDocs(pages: DocPage[], query: string, limit = 5): DocHit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const hits: DocHit[] = [];
  for (const p of pages) {
    const title = p.title.toLowerCase();
    const body = p.body.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (title.includes(t)) score += 3;
      score += countOccurrences(body, t);
    }
    if (score > 0) hits.push({ url: p.url, title: p.title, excerpt: excerptAround(p.body, terms), score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** A doc slug is a relative path of plain segments: no scheme, no traversal, no leading slash. */
export function isSafeDocSlug(slug: string): boolean {
  if (!slug || slug.length > 200) return false;
  return slug.split("/").every((seg) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(seg) && !seg.includes(".."));
}

export type DocsSourceOptions = {
  docsUrl: string;
  fetchImpl?: typeof fetch;
  ttlMs?: number;
  now?: () => number;
  timeoutMs?: number;
};

export function createDocsSource(opts: DocsSourceOptions) {
  const base = opts.docsUrl.replace(/\/+$/, "");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ttlMs = opts.ttlMs ?? 600_000;
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? 10_000;

  async function getText(url: string): Promise<string> {
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctrl.abort();
        reject(new Error(`Request to ${url} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        (async () => {
          const res = await fetchImpl(url, { signal: ctrl.signal });
          if (!res.ok) throw new Error(`Request to ${url} failed with status ${res.status}`);
          return res.text();
        })(),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  let cache: { pages: DocPage[]; at: number } | null = null;

  return {
    async pages(): Promise<DocPage[]> {
      if (cache && now() - cache.at < ttlMs) return cache.pages;
      const pages = parseLlmsFull(await getText(`${base}/llms-full.txt`));
      cache = { pages, at: now() };
      return pages;
    },
    async page(slug: string): Promise<string> {
      return getText(`${base}/md/${slug}`);
    },
  };
}
