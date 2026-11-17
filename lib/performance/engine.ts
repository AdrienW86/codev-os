import "server-only";
// Client du moteur CODE-V Performance (PageSpeed Insights / Lighthouse), hébergé par le site code-v.fr. Partagé par
// la page /performance (audit manuel) et l'audit hebdomadaire de l'Agent Monitoring. Le même moteur pourra servir
// le testeur public du site code-v.fr : le secret de service reste côté serveur, jamais exposé au navigateur.
import type { Json } from "@/lib/supabase/database.types";

export type Strategy = "mobile" | "desktop";
export type EngineReport = {
  url: string; strategy: Strategy; analyzedAt: string;
  source: string; scores: Json; lab: Json; field: Json; opportunities: Json;
};

export class EngineError extends Error {
  constructor(message: string, readonly status: number, readonly kind: "not_configured" | "upstream" | "unreachable") { super(message); }
}

type Env = Record<string, string | undefined>;
type FetchLike = (input: URL, init: RequestInit) => Promise<Response>;

/** Adresse et secret du moteur, ou la raison pour laquelle il n'est pas utilisable. */
export function engineConfig(env: Env = process.env): { ok: true; url: URL; key: string } | { ok: false; message: string } {
  const key = env.CODEV_PERFORMANCE_SERVICE_KEY;
  if (!key || key.length < 24) return { ok: false, message: "Clé de service CODE-V Performance non configurée." };
  let url: URL;
  try { url = new URL(env.CODEV_PERFORMANCE_API_URL || "https://www.code-v.fr/api/performance"); } catch { return { ok: false, message: "URL du moteur invalide." }; }
  if (url.protocol !== "https:" && !(env.NODE_ENV !== "production" && url.hostname === "localhost")) return { ok: false, message: "Le moteur doit utiliser HTTPS." };
  return { ok: true, url, key };
}

/** Lance un audit Lighthouse (4 catégories) d'une URL. Lève EngineError avec le statut HTTP à renvoyer. */
export async function runEngineAudit(input: { url: string; strategy: Strategy }, options: { env?: Env; fetchImpl?: FetchLike; timeoutMs?: number } = {}): Promise<EngineReport> {
  const config = engineConfig(options.env);
  if (!config.ok) throw new EngineError(config.message, 503, "not_configured");
  let upstream: Response, result: { error?: unknown } & Partial<EngineReport>;
  try {
    upstream = await (options.fetchImpl ?? fetch)(config.url, {
      method: "POST", headers: { "Content-Type": "application/json", "x-codev-service-key": config.key },
      body: JSON.stringify({ url: input.url, strategy: input.strategy }), cache: "no-store", signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
    });
    result = await upstream.json();
  } catch {
    throw new EngineError("Impossible de joindre CODE-V Performance.", 502, "unreachable");
  }
  if (!upstream.ok) {
    const status = [400, 422, 429, 503, 504].includes(upstream.status) ? upstream.status : 502;
    throw new EngineError(typeof result?.error === "string" ? result.error : "Moteur indisponible.", status, "upstream");
  }
  if (!result || typeof result.url !== "string" || !result.scores || !result.lab) throw new EngineError("Impossible de joindre CODE-V Performance.", 502, "unreachable");
  return result as EngineReport;
}

type InsertDb = { from(table: "performance_audits"): { insert(row: Record<string, unknown>): PromiseLike<{ error: unknown }> } };

/** Archive un audit dans public.performance_audits. false si l'écriture échoue (migration absente, par exemple). */
export async function saveAudit(db: InsertDb, clientId: string | null, report: EngineReport): Promise<boolean> {
  try {
    const { error } = await db.from("performance_audits").insert({
      client_id: clientId, url: report.url, strategy: report.strategy, source: report.source,
      scores: report.scores, lab: report.lab, field: report.field, opportunities: report.opportunities,
      analyzed_at: report.analyzedAt,
    });
    return !error;
  } catch { return false; }
}
