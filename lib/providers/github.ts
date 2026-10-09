import "server-only";
// GitHub : derniers commits d'un dépôt (lecture seule). Jamais d'écriture ni d'installation de dépendance.
import { providerJson, type FetchLike } from "@/lib/providers/api";
import { ProviderError } from "@/lib/providers/errors";

type Env = Record<string, string | undefined>;
export type Commit = { sha: string; message: string; date: string | null };

export async function recentCommits(repository: string, options: { env?: Env; fetchImpl?: FetchLike; limit?: number } = {}): Promise<Commit[]> {
  const env = options.env ?? process.env;
  if (!env.GITHUB_TOKEN) throw new ProviderError("github", "not_configured");
  if (!/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(repository) || repository.includes("..")) throw new ProviderError("github", "blocked");
  const data = await providerJson<unknown>("github", `https://api.github.com/repos/${repository}/commits?per_page=${Math.min(options.limit ?? 5, 20)}`, {
    fetchImpl: options.fetchImpl, headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (!Array.isArray(data)) throw new ProviderError("github", "malformed");
  return data.map((item) => {
    const value = item as { sha?: unknown; commit?: { message?: unknown; author?: { date?: unknown } } };
    if (typeof value.sha !== "string") throw new ProviderError("github", "malformed");
    return { sha: value.sha.slice(0, 12), message: String(value.commit?.message ?? "").split("\n")[0].slice(0, 200), date: typeof value.commit?.author?.date === "string" ? value.commit.author.date : null };
  });
}
