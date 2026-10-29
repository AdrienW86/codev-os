// Contrats purs de l'Agent Développeur : aucun accès distant ni écriture.
import { z } from "zod";

export const DEVELOPER_BRANCH_PREFIX = "codev-dev/";
export const developerRepositorySchema = z.string()
  .regex(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/)
  .refine((value) => !value.includes(".."));
const shaSchema = z.string().regex(/^[a-f0-9]{40}$/);
const refSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9._/-]+$/)
  .refine((value) => !value.includes("..") && !value.startsWith("/") && !value.endsWith("/") && !value.endsWith(".lock"));

/** Le Directeur transmet un objectif borné, jamais une commande shell ou un dépôt libre. */
export const developerMissionSchema = z.object({
  clientId: z.uuid(),
  repository: developerRepositorySchema,
  objective: z.string().trim().min(10).max(2000),
  kind: z.enum(["seo_article", "site_change", "bugfix"]),
  requestedBy: z.string().regex(/^user_[a-zA-Z0-9_-]{1,200}$/),
}).strict();

export type DeveloperPullRequest = {
  repository: string;
  number: number;
  title: string;
  url: string;
  headBranch: string;
  headSha: string;
  baseBranch: string;
  draft: boolean;
  state: "open" | "closed";
};
export type CheckState = "passed" | "failed" | "pending" | "unknown";

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function parseDeveloperPullRequest(repository: string, value: unknown): DeveloperPullRequest | null {
  if (!developerRepositorySchema.safeParse(repository).success) return null;
  const row = object(value), head = object(row?.head), base = object(row?.base);
  const number = row?.number, title = row?.title, url = row?.html_url;
  const headBranch = head?.ref, headSha = head?.sha, baseBranch = base?.ref;
  if (!Number.isSafeInteger(number) || (number as number) < 1 || typeof title !== "string" || !title.trim() || title.length > 300
    || typeof headBranch !== "string" || !headBranch.startsWith(DEVELOPER_BRANCH_PREFIX) || !refSchema.safeParse(headBranch).success
    || typeof baseBranch !== "string" || !refSchema.safeParse(baseBranch).success
    || typeof headSha !== "string" || !shaSchema.safeParse(headSha).success
    || !["open", "closed"].includes(String(row?.state)) || typeof row?.draft !== "boolean"
    || url !== `https://github.com/${repository}/pull/${number}`) return null;
  // Les PR de forks et les branches par défaut ne sont pas des travaux de l'Agent Développeur.
  if (object(head?.repo)?.full_name !== repository || headBranch === baseBranch) return null;
  return {
    repository, number: number as number, title: title.trim(), url: url as string,
    headBranch, headSha, baseBranch, draft: row.draft, state: row.state as "open" | "closed",
  };
}

/** "passed" signifie : les vérifications consultées ont réussi, pas que toutes les règles de protection sont satisfaites. */
export function observedCheckState(status: unknown, checks: unknown): CheckState {
  const state = object(status)?.state;
  const runs = object(checks)?.check_runs;
  if (!["success", "failure", "error", "pending", null, undefined].includes(state as string | null | undefined)) return "unknown";
  if (runs !== undefined && !Array.isArray(runs)) return "unknown";
  const items = (runs ?? []) as unknown[];
  if (items.some((item) => {
    const run = object(item);
    return ["failure", "cancelled", "timed_out", "action_required", "startup_failure"].includes(String(run?.conclusion));
  }) || state === "failure" || state === "error") return "failed";
  if (items.some((item) => object(item)?.status !== "completed") || state === "pending") return "pending";
  if (items.some((item) => !["success", "neutral", "skipped"].includes(String(object(item)?.conclusion)))) return "unknown";
  return (state === "success" || items.length > 0) ? "passed" : "unknown";
}

/** Accepte seulement une URL de prévisualisation Vercel confirmée pour le SHA exact de la PR. */
export function verifiedPreviewUrl(deployments: unknown, headSha: string): string | null {
  if (!shaSchema.safeParse(headSha).success || !Array.isArray(deployments)) return null;
  for (const candidate of deployments) {
    const deployment = object(candidate);
    if (deployment?.sha !== headSha || !String(deployment?.environment ?? "").toLowerCase().includes("preview")) continue;
    const statuses = deployment.statuses;
    if (!Array.isArray(statuses)) continue;
    for (const item of statuses) {
      const status = object(item);
      if (status?.state !== "success" || typeof status.environment_url !== "string") continue;
      try {
        const url = new URL(status.environment_url);
        if (url.protocol === "https:" && !url.username && !url.password && !url.port && url.hostname.endsWith(".vercel.app")) {
          return url.origin + url.pathname + url.search;
        }
      } catch { /* URL non fiable */ }
    }
  }
  return null;
}

/** Une décision est liée au SHA : un nouveau commit invalide impérativement la validation. */
export function approvalMatchesHead(approvedSha: string | null, currentSha: string): boolean {
  return Boolean(approvedSha && shaSchema.safeParse(approvedSha).success && approvedSha === currentSha);
}
