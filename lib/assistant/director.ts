import "server-only";
import { requireAdmin } from "@/lib/require-admin";
import { getActiveScenario } from "@/lib/simulation/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { resolveClient } from "@/lib/assistant/clients";
import { describeAction } from "@/lib/actions/registry";
import { todayInParis } from "@/lib/dashboard/home";
import { buildDirectorBriefing, directorSummary, DIRECTOR_LIMIT, type DirectorCoverage, type DirectorSource } from "@/lib/assistant/director-model";
import type { ToolOutcome } from "@/lib/assistant/orchestrator";

const CLIENT_LIMIT = 100;
type ReadResult<T> = { data: T[] | null; error: unknown; count?: number | null };

/** A failed source is never converted into zero urgent items. Neither SQL errors nor payloads escape. */
async function readSource<T>(source: DirectorSource, query: PromiseLike<ReadResult<T>>): Promise<{ rows: T[]; coverage: DirectorCoverage }> {
  try {
    const result = await query;
    if (result.error || !result.data) throw new Error("director source unavailable");
    return { rows: result.data.slice(0, DIRECTOR_LIMIT), coverage: {
      source, status: "available", loaded: Math.min(result.data.length, DIRECTOR_LIMIT), total: result.count ?? null,
      truncated: result.data.length > DIRECTOR_LIMIT || (result.count ?? 0) > DIRECTOR_LIMIT,
    } };
  } catch {
    return { rows: [], coverage: { source, status: "unavailable", loaded: 0, total: null, truncated: false } };
  }
}

/** Admin-only existing-output read. No agent run, recommendation insertion or provider request. */
export async function directorBriefingTool(input: Record<string, unknown>): Promise<ToolOutcome> {
  await requireAdmin();
  if (await getActiveScenario()) return { ok: false, text: "Simulation active : aucun diagnostic des clients réels n’est effectué." };
  const focus = input.focus === "seo" || input.focus === "ads" ? input.focus : "all";
  const db = getSupabaseServerClient();
  let selectedId: string | null = null;
  let selectedName: string | null = null;
  if (typeof input.client === "string") {
    const client = await resolveClient(input.client);
    if (!client.ok) return { ok: false, text: client.message, links: [{ label: "Clients", href: "/clients" }] };
    selectedId = client.id; selectedName = client.name;
  }
  const clientsQuery = db.from("clients").select("id,name", { count: "exact" }).order("name").order("id").limit(CLIENT_LIMIT).abortSignal(AbortSignal.timeout(12_000));
  const clients = await (selectedId ? clientsQuery.eq("id", selectedId) : clientsQuery);
  if (clients.error || !clients.data) return { ok: false, text: "Liste des clients indisponible : le diagnostic ne peut pas établir de priorités fiables.", links: [{ label: "Clients", href: "/clients" }] };
  const today = todayInParis();
  const ids = clients.data.map((client) => client.id);
  const scope = selectedName ?? (focus === "seo" ? "Tous les clients · SEO" : focus === "ads" ? "Tous les clients · Google Ads" : "Tous les clients");
  const noRows = <T,>(source: DirectorSource) => Promise.resolve({ rows: [] as T[], coverage: { source, status: "available" as const, loaded: 0, total: 0, truncated: false } });
  // Select only this page's client identifiers. Even a provider/fixture returning extra clients is
  // checked again by the pure model. Stable ordering and exact counts expose bounded coverage.
  const [incidents, tasks, actions, recommendations, seo] = ids.length ? await Promise.all([
    readSource("incidents", db.from("incidents").select("id,client_id,title,severity,source,status,updated_at,recommendation_id", { count: "exact" })
      .in("client_id", ids).neq("status", "resolved").order("updated_at", { ascending: false }).order("id").limit(DIRECTOR_LIMIT + 1).abortSignal(AbortSignal.timeout(12_000))),
    readSource("tasks", db.from("tasks").select("id,client_id,title,priority,status,due_date,updated_at", { count: "exact" })
      .in("client_id", ids).neq("status", "Terminé").lte("due_date", today).order("due_date").order("id").limit(DIRECTOR_LIMIT + 1).abortSignal(AbortSignal.timeout(12_000))),
    readSource("actions", db.from("actions").select("id,client_id,action_type,parameters,status,created_at,recommendation_id", { count: "exact" })
      .in("client_id", ids).eq("status", "pending_approval").order("created_at").order("id").limit(DIRECTOR_LIMIT + 1).abortSignal(AbortSignal.timeout(12_000))),
    readSource("recommendations", db.from("recommendations").select("id,client_id,title,severity,reason,status,created_at,agent:agents(agent_type)", { count: "exact" })
      .in("client_id", ids).eq("status", "pending").order("created_at", { ascending: false }).order("id").limit(DIRECTOR_LIMIT + 1).abortSignal(AbortSignal.timeout(12_000))),
    readSource("seo", db.from("metric_snapshots").select("id,client_id,period_start,period_end,data,fetched_at", { count: "exact" })
      .in("client_id", ids).eq("provider", "search-console").eq("metric_key", "summary").lt("period_end", today)
      .order("period_end", { ascending: false }).order("fetched_at", { ascending: false }).order("id").limit(DIRECTOR_LIMIT + 1).abortSignal(AbortSignal.timeout(12_000))),
  ]) : await Promise.all([
    noRows<import("@/lib/assistant/director-model").DirectorIncident>("incidents"),
    noRows<import("@/lib/assistant/director-model").DirectorTask>("tasks"),
    noRows<{ id: string; client_id: string | null; action_type: string; parameters: unknown; status: string; created_at: string; recommendation_id: string | null }>("actions"),
    noRows<{ id: string; client_id: string; title: string; severity: string; reason: string | null; status: string; created_at: string; agent: { agent_type: string | null } | null }>("recommendations"),
    noRows<import("@/lib/assistant/director-model").DirectorSeo>("seo"),
  ]);
  const briefing = buildDirectorBriefing({ today, now: new Date().toISOString(), scope,
    clients: clients.data, clientTotal: clients.count ?? null, focus,
    coverage: [incidents.coverage, tasks.coverage, actions.coverage, recommendations.coverage, seo.coverage],
    incidents: incidents.rows, tasks: tasks.rows, seo: seo.rows,
    actions: actions.rows.map((action) => ({ ...action, title: describeAction(action.action_type, action.parameters) })),
    recommendations: recommendations.rows.map((recommendation) => ({ ...recommendation,
      source: recommendation.agent?.agent_type === "google-ads" ? "ads" : recommendation.agent?.agent_type ?? "unknown" })),
  });
  return { ok: true, text: directorSummary(briefing), view: { type: "director_briefing", title: "Diagnostic du Directeur IA", briefing },
    links: [{ label: "Clients", href: "/clients" }, { label: "Actions à valider", href: "/work?view=review" }],
    // A named client is resolved again on subsequent tools; global diagnosis clears a stale client.
    context: selectedId && selectedName ? { clientId: selectedId, clientName: selectedName } : {},
  };
}
