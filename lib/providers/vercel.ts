import "server-only";
// Vercel : dernier déploiement d'un projet (lecture seule).
import { providerJson, type FetchLike } from "@/lib/providers/api";
import { ProviderError } from "@/lib/providers/errors";

type Env = Record<string, string | undefined>;
export type Deployment = { id: string; state: string; createdAt: number; url: string | null; target: string | null };

export async function latestDeployment(projectId: string, options: { env?: Env; fetchImpl?: FetchLike } = {}): Promise<Deployment | null> {
  const env = options.env ?? process.env;
  if (!env.VERCEL_TOKEN) throw new ProviderError("vercel", "not_configured");
  if (!/^prj_[A-Za-z0-9]{6,64}$/.test(projectId)) throw new ProviderError("vercel", "blocked");
  const params = new URLSearchParams({ projectId, limit: "1" });
  if (env.VERCEL_TEAM_ID) params.set("teamId", env.VERCEL_TEAM_ID);
  const data = await providerJson<{ deployments?: unknown }>("vercel", `https://api.vercel.com/v6/deployments?${params}`, { fetchImpl: options.fetchImpl, headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}` } });
  if (!Array.isArray(data.deployments)) throw new ProviderError("vercel", "malformed");
  const first = data.deployments[0] as Record<string, unknown> | undefined;
  if (!first) return null;
  if (typeof first.uid !== "string" || typeof first.state !== "string") throw new ProviderError("vercel", "malformed");
  return { id: first.uid, state: first.state, createdAt: Number(first.created ?? 0), url: typeof first.url === "string" ? first.url : null, target: typeof first.target === "string" ? first.target : null };
}
