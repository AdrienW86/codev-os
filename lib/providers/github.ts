import "server-only";
// GitHub : lecture seule des dépôts clients. Jamais d’écriture ni d’installation de dépendance.
import { Buffer } from "node:buffer";
import { providerJson, type FetchLike } from "@/lib/providers/api";
import { ProviderError } from "@/lib/providers/errors";

type Env = Record<string, string | undefined>;
export type Commit = { sha: string; message: string; date: string | null };
export type SeoPageContext = {
  targetUrl: string;
  repository: string;
  branch: string;
  path: string;
  sha: string | null;
  title: string | null;
  description: string | null;
  h1: string | null;
};

const repositoryPattern = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const sourcePattern = /\.(?:tsx|ts|jsx|js|mdx|html)$/i;

function authHeaders(env: Env) {
  if (!env.GITHUB_TOKEN) throw new ProviderError("github", "not_configured");
  return { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
}

function validRepository(repository: string) {
  return repositoryPattern.test(repository) && !repository.includes("..");
}

export async function recentCommits(repository: string, options: { env?: Env; fetchImpl?: FetchLike; limit?: number } = {}): Promise<Commit[]> {
  const env = options.env ?? process.env;
  if (!validRepository(repository)) throw new ProviderError("github", "blocked");
  const data = await providerJson<unknown>("github", `https://api.github.com/repos/${repository}/commits?per_page=${Math.min(options.limit ?? 5, 20)}`, {
    fetchImpl: options.fetchImpl, headers: authHeaders(env),
  });
  if (!Array.isArray(data)) throw new ProviderError("github", "malformed");
  return data.map((item) => {
    const value = item as { sha?: unknown; commit?: { message?: unknown; author?: { date?: unknown } } };
    if (typeof value.sha !== "string") throw new ProviderError("github", "malformed");
    return { sha: value.sha.slice(0, 12), message: String(value.commit?.message ?? "").split("\n")[0].slice(0, 200), date: typeof value.commit?.author?.date === "string" ? value.commit.author.date : null };
  });
}

function routeCandidates(targetUrl: string) {
  let pathname = "/";
  try { pathname = new URL(targetUrl).pathname; } catch { return []; }
  const route = pathname.replace(/\/+$/, "").replace(/^\/+/, "");
  if (!route) return ["app/page.tsx", "src/app/page.tsx", "pages/index.tsx", "src/pages/index.tsx", "app/page.jsx", "src/app/page.jsx", "pages/index.jsx", "src/pages/index.jsx"];
  const segments = route.split("/").filter(Boolean);
  const joined = segments.join("/");
  return [
    `app/${joined}/page.tsx`, `src/app/${joined}/page.tsx`, `app/${joined}/page.jsx`, `src/app/${joined}/page.jsx`,
    `pages/${joined}.tsx`, `src/pages/${joined}.tsx`, `pages/${joined}.jsx`, `src/pages/${joined}.jsx`,
    `pages/${joined}/index.tsx`, `src/pages/${joined}/index.tsx`, `pages/${joined}/index.jsx`, `src/pages/${joined}/index.jsx`,
  ];
}

function scorePath(path: string, targetUrl: string) {
  const candidates = routeCandidates(targetUrl);
  const exact = candidates.indexOf(path);
  if (exact >= 0) return 1000 - exact;
  let pathname = "";
  try { pathname = new URL(targetUrl).pathname.toLowerCase(); } catch { return -1; }
  const segments = pathname.split("/").filter(Boolean);
  let score = 0;
  for (const segment of segments) if (path.toLowerCase().includes(segment)) score += 20;
  if (/\/(?:page|index)\.(?:tsx|jsx|mdx|html)$/i.test("/" + path)) score += 10;
  if (path.startsWith("app/") || path.startsWith("src/app/") || path.startsWith("pages/") || path.startsWith("src/pages/")) score += 5;
  return score;
}

function textValue(source: string, regexes: RegExp[]) {
  for (const regex of regexes) {
    const match = source.match(regex);
    const value = match?.[1]?.replace(/\s+/g, " ").trim();
    if (value) return value.slice(0, 300);
  }
  return null;
}

function summarizeSource(source: string) {
  return {
    title: textValue(source, [
      /\btitle\s*:\s*["'`]([^"'`]{1,300})["'`]/i,
      /<title[^>]*>([^<]{1,300})<\/title>/i,
    ]),
    description: textValue(source, [
      /\bdescription\s*:\s*["'`]([^"'`]{1,500})["'`]/i,
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,500})["']/i,
    ]),
    h1: textValue(source, [/<h1[^>]*>([^<]{1,300})<\/h1>/i]),
  };
}

export async function readSeoPageContexts(
  repository: string,
  targetUrls: string[],
  options: { env?: Env; fetchImpl?: FetchLike; maxFiles?: number } = {},
): Promise<SeoPageContext[]> {
  const env = options.env ?? process.env;
  if (!validRepository(repository)) throw new ProviderError("github", "blocked");
  const headers = authHeaders(env);
  const repo = await providerJson<{ default_branch?: unknown }>("github", `https://api.github.com/repos/${repository}`, { fetchImpl: options.fetchImpl, headers });
  if (typeof repo.default_branch !== "string" || !repo.default_branch) throw new ProviderError("github", "malformed");
  const branch = repo.default_branch;
  const tree = await providerJson<{ tree?: unknown }>("github", `https://api.github.com/repos/${repository}/git/trees/${encodeURIComponent(branch)}?recursive=1`, { fetchImpl: options.fetchImpl, headers, timeoutMs: 30_000 });
  if (!Array.isArray(tree.tree)) throw new ProviderError("github", "malformed");
  const files = tree.tree.flatMap((entry) => {
    const value = entry as { path?: unknown; type?: unknown; size?: unknown; sha?: unknown };
    if (value.type !== "blob" || typeof value.path !== "string" || !sourcePattern.test(value.path)) return [];
    const size = typeof value.size === "number" ? value.size : null;
    if (size !== null && size > 180_000) return [];
    return [{ path: value.path, sha: typeof value.sha === "string" ? value.sha : null }];
  });

  const targets = [...new Set(targetUrls.filter((url) => {
    try { const parsed = new URL(url); return parsed.protocol === "https:" || parsed.protocol === "http:"; } catch { return false; }
  }))].slice(0, options.maxFiles ?? 8);

  const selected = targets.flatMap((targetUrl) => {
    const ranked = files.map((file) => ({ ...file, score: scorePath(file.path, targetUrl) })).filter((file) => file.score > 0).sort((a, b) => b.score - a.score);
    return ranked[0] ? [{ targetUrl, ...ranked[0] }] : [];
  });
  const uniquePaths = [...new Set(selected.map((item) => item.path))].slice(0, options.maxFiles ?? 8);
  const sourceByPath = new Map<string, { source: string; sha: string | null }>();

  await Promise.all(uniquePaths.map(async (path) => {
    const data = await providerJson<{ content?: unknown; encoding?: unknown; sha?: unknown }>("github", `https://api.github.com/repos/${repository}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`, { fetchImpl: options.fetchImpl, headers });
    if (data.encoding !== "base64" || typeof data.content !== "string") return;
    const source = Buffer.from(data.content.replace(/\s/g, ""), "base64").toString("utf8");
    if (source.length > 200_000) return;
    sourceByPath.set(path, { source, sha: typeof data.sha === "string" ? data.sha : null });
  }));

  return selected.flatMap((item) => {
    const loaded = sourceByPath.get(item.path);
    if (!loaded) return [];
    const summary = summarizeSource(loaded.source);
    return [{ targetUrl: item.targetUrl, repository, branch, path: item.path, sha: loaded.sha ?? item.sha, ...summary }];
  });
}
