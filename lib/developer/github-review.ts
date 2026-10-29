import "server-only";
// Lecture seule GitHub ; aucun endpoint GitHub d'écriture ou de fusion n'est appelé.
import { providerJson, type FetchLike } from "@/lib/providers/api";
import { ProviderError } from "@/lib/providers/errors";
import { developerRepositorySchema, observedCheckState, parseDeveloperPullRequest, verifiedPreviewUrl, type CheckState, type DeveloperPullRequest } from "@/lib/developer/pr-model";

type Env = Record<string, string | undefined>;
type Options = { env?: Env; fetchImpl?: FetchLike };

function access(repository: string, options: Options) {
  if (!developerRepositorySchema.safeParse(repository).success) throw new ProviderError("github", "blocked");
  const token = (options.env ?? process.env).GITHUB_TOKEN?.trim();
  if (!token) throw new ProviderError("github", "not_configured");
  return {
    api: `https://api.github.com/repos/${repository}`,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  };
}

export async function listDeveloperPullRequests(repository: string, options: Options = {}): Promise<DeveloperPullRequest[]> {
  const { api, headers } = access(repository, options);
  const rows = await providerJson<unknown>("github", `${api}/pulls?state=open&per_page=30`, { headers, fetchImpl: options.fetchImpl });
  if (!Array.isArray(rows)) throw new ProviderError("github", "malformed");
  return rows.flatMap((row) => {
    const parsed = parseDeveloperPullRequest(repository, row);
    return parsed ? [parsed] : [];
  });
}

export type DeveloperReview = {
  pullRequest: DeveloperPullRequest;
  checks: CheckState;
  previewUrl: string | null;
  /** Aucune fusion n'est autorisée par ce service, même si les contrôles sont verts. */
  requiresHumanApproval: true;
  warning: string | null;
};

export async function readDeveloperReview(repository: string, number: number, options: Options = {}): Promise<DeveloperReview | null> {
  const { api, headers } = access(repository, options);
  if (!Number.isSafeInteger(number) || number < 1 || number > 100_000_000) throw new ProviderError("github", "blocked");
  const raw = await providerJson<unknown>("github", `${api}/pulls/${number}`, { headers, fetchImpl: options.fetchImpl });
  const pullRequest = parseDeveloperPullRequest(repository, raw);
  if (!pullRequest || pullRequest.number !== number) return null;
  const sha = pullRequest.headSha;

  // Une erreur de statut n'est jamais transformée en succès implicite.
  const results = await Promise.allSettled([
    providerJson<unknown>("github", `${api}/commits/${sha}/status`, { headers, fetchImpl: options.fetchImpl }),
    providerJson<unknown>("github", `${api}/commits/${sha}/check-runs?per_page=100`, { headers, fetchImpl: options.fetchImpl }),
    providerJson<unknown>("github", `${api}/deployments?sha=${sha}&per_page=10`, { headers, fetchImpl: options.fetchImpl }),
  ]);
  const checks = results[0].status === "fulfilled" && results[1].status === "fulfilled"
    ? observedCheckState(results[0].value, results[1].value) : "unknown";

  const deployments: unknown[] = [];
  if (results[2].status === "fulfilled" && Array.isArray(results[2].value)) {
    for (const rawDeployment of results[2].value.slice(0, 5)) {
      if (!rawDeployment || typeof rawDeployment !== "object" || Array.isArray(rawDeployment)) continue;
      const deployment = rawDeployment as Record<string, unknown>;
      if (deployment.sha !== sha || !Number.isSafeInteger(deployment.id)) continue;
      try {
        const statuses = await providerJson<unknown>("github", `${api}/deployments/${deployment.id}/statuses?per_page=10`, { headers, fetchImpl: options.fetchImpl });
        deployments.push({ ...deployment, statuses });
      } catch { /* Prévisualisation indisponible, jamais supposée valide. */ }
    }
  }
  return {
    pullRequest, checks, previewUrl: verifiedPreviewUrl(deployments, sha),
    requiresHumanApproval: true,
    warning: results.some((result) => result.status === "rejected") ? "Certaines vérifications GitHub sont indisponibles : validation bloquée jusqu'au contrôle manuel." : null,
  };
}
