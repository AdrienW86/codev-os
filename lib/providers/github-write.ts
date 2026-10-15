import "server-only";
// GitHub — écriture limitée à une PROPOSITION : branche dédiée + commit d'un fichier + pull request en brouillon.
// Jeton distinct du jeton de lecture (GITHUB_SEO_WRITE_TOKEN, permissions Contents et Pull requests en écriture,
// restreint aux dépôts des sites clients). Jamais de fusion, de push sur la branche par défaut ni de suppression.
import { Buffer } from "node:buffer";
import { providerJson, type FetchLike } from "@/lib/providers/api";
import { ProviderError } from "@/lib/providers/errors";
import { SEO_BRANCH_PREFIX, applyEdits, type GithubChange } from "@/lib/seo/github-change-model";

type Env = Record<string, string | undefined>;
type Options = { env?: Env; fetchImpl?: FetchLike };
export type PullRequestResult = { branch: string; commitSha: string; pullRequestUrl: string; pullRequestNumber: number };

export const githubWriteConfigured = (env: Env = process.env) => Boolean(env.GITHUB_SEO_WRITE_TOKEN?.trim());

function headers(env: Env) {
  const token = env.GITHUB_SEO_WRITE_TOKEN?.trim();
  if (!token) throw new ProviderError("github", "not_configured");
  return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" };
}

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");
const encodeRef = (ref: string) => ref.split("/").map(encodeURIComponent).join("/");

/** Lecture d'un fichier à une référence : contenu et empreinte de blob (pour figer la version modifiée). */
export async function readRepositoryFile(repository: string, path: string, ref: string, options: Options = {}) {
  const env = options.env ?? process.env;
  const token = env.GITHUB_SEO_WRITE_TOKEN?.trim() || env.GITHUB_TOKEN?.trim();
  if (!token) throw new ProviderError("github", "not_configured");
  const data = await providerJson<{ content?: unknown; encoding?: unknown; sha?: unknown }>("github", `https://api.github.com/repos/${repository}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`, {
    fetchImpl: options.fetchImpl, headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (data.encoding !== "base64" || typeof data.content !== "string" || typeof data.sha !== "string") throw new ProviderError("github", "malformed");
  return { content: Buffer.from(data.content.replace(/\s/g, ""), "base64").toString("utf8"), sha: data.sha };
}

/**
 * Crée la branche, y applique les remplacements approuvés (fichier inchangé depuis la préparation) et ouvre une PR
 * en brouillon. Une branche existante n'est jamais réutilisée ni écrasée.
 */
export async function openSeoPullRequest(change: GithubChange, options: Options = {}): Promise<PullRequestResult> {
  const env = options.env ?? process.env;
  const auth = headers(env);
  if (!change.branch.startsWith(SEO_BRANCH_PREFIX) || change.branch === change.base_branch) throw new ProviderError("github", "blocked");
  const api = `https://api.github.com/repos/${change.repository}`;
  const base = await providerJson<{ object?: { sha?: unknown } }>("github", `${api}/git/ref/heads/${encodeRef(change.base_branch)}`, { fetchImpl: options.fetchImpl, headers: auth });
  if (typeof base.object?.sha !== "string") throw new ProviderError("github", "malformed");
  const file = await readRepositoryFile(change.repository, change.path, change.base_branch, options);
  if (file.sha !== change.base_sha) throw new ProviderError("github", "rejected", 409, "file_changed_since_preparation");
  const edited = applyEdits(file.content, change.edits);
  if (!edited.ok) throw new ProviderError("github", "rejected", 409, "edit_not_applicable");
  await providerJson("github", `${api}/git/refs`, { method: "POST", fetchImpl: options.fetchImpl, headers: auth, body: JSON.stringify({ ref: `refs/heads/${change.branch}`, sha: base.object.sha }) });
  const commit = await providerJson<{ commit?: { sha?: unknown } }>("github", `${api}/contents/${encodePath(change.path)}`, {
    method: "PUT", fetchImpl: options.fetchImpl, headers: auth,
    body: JSON.stringify({ message: change.pr_title, content: Buffer.from(edited.content, "utf8").toString("base64"), sha: file.sha, branch: change.branch }),
  });
  const pull = await providerJson<{ html_url?: unknown; number?: unknown }>("github", `${api}/pulls`, {
    method: "POST", fetchImpl: options.fetchImpl, headers: auth,
    body: JSON.stringify({ title: change.pr_title, head: change.branch, base: change.base_branch, body: change.pr_body, draft: true, maintainer_can_modify: true }),
  });
  if (typeof pull.html_url !== "string" || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(pull.html_url) || typeof pull.number !== "number") throw new ProviderError("github", "malformed");
  return { branch: change.branch, commitSha: typeof commit.commit?.sha === "string" ? commit.commit.sha : "", pullRequestUrl: pull.html_url, pullRequestNumber: pull.number };
}
