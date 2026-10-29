import "server-only";
import { requireAdmin } from "@/lib/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { developerRepositorySchema, type DeveloperPullRequest } from "@/lib/developer/pr-model";
import { listDeveloperPullRequests, readDeveloperReview } from "@/lib/developer/github-review";

type ConnectedRepo = { clientId: string; clientName: string; repository: string };

export async function developerClientRepositories(): Promise<ConnectedRepo[]> {
  await requireAdmin();
  const db = getSupabaseServerClient();
  const { data: connections, error } = await db.from("client_connections")
    .select("client_id,metadata").eq("provider", "github").not("client_id", "is", null).limit(100);
  if (error) throw new Error("Connexions GitHub indisponibles.");
  const rows = (connections ?? []).flatMap((row) => {
    const metadata = row.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
    const repository = (metadata as Record<string, unknown>).repository;
    return typeof row.client_id === "string" && typeof repository === "string" && developerRepositorySchema.safeParse(repository).success
      ? [{ clientId: row.client_id, repository }] : [];
  });
  if (!rows.length) return [];
  const ids = [...new Set(rows.map((item) => item.clientId))];
  const { data: clients, error: clientError } = await db.from("clients").select("id,name").in("id", ids);
  if (clientError) throw new Error("Clients indisponibles.");
  const names = new Map((clients ?? []).map((row) => [row.id, row.name]));
  return rows.flatMap((row) => {
    const clientName = names.get(row.clientId);
    return clientName ? [{ ...row, clientName }] : [];
  });
}

export type DeveloperReviewList = { repositories: ConnectedRepo[]; requests: { clientId: string; clientName: string; pullRequest: DeveloperPullRequest }[]; errors: string[] };

export async function listDeveloperReviews(): Promise<DeveloperReviewList> {
  await requireAdmin();
  const repositories = await developerClientRepositories();
  const results = await Promise.allSettled(repositories.slice(0, 20).map((repo) => listDeveloperPullRequests(repo.repository)));
  const requests: DeveloperReviewList["requests"] = [], errors: string[] = [];
  results.forEach((result, index) => {
    const repo = repositories[index];
    if (result.status !== "fulfilled") { errors.push(`GitHub indisponible pour ${repo.clientName}.`); return; }
    for (const pullRequest of result.value) requests.push({ clientId: repo.clientId, clientName: repo.clientName, pullRequest });
  });
  if (repositories.length > 20) errors.push("Plus de 20 connexions : affichage partiel.");
  return { repositories, requests: requests.slice(0, 50), errors };
}

export async function getDeveloperReview(clientId: string, number: number) {
  await requireAdmin();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) return null;
  const repositories = await developerClientRepositories();
  const linked = repositories.find((repo) => repo.clientId === clientId);
  if (!linked) return null;
  const review = await readDeveloperReview(linked.repository, number);
  return review ? { ...review, clientId, clientName: linked.clientName } : null;
}
