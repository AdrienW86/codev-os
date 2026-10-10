import "server-only";
// Exécution des outils de l'assistant. Chaque outil passe par le moteur de permissions quand il
// touche à une capacité d'agent ; les écritures n'arrivent ici qu'après confirmation explicite.
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/core/audit";
import type { Actor } from "@/lib/core/actor";
import { authorize } from "@/lib/permissions/engine";
import { agentDefinitions, isAgentType, runTypes, type CapabilityId } from "@/lib/agents/registry";
import { getAgentByType } from "@/lib/agents/outputs";
import { isProviderConfigured } from "@/lib/system/providers";
import { generateReport, listReports } from "@/lib/reports/service";
import { reportStatusLabels } from "@/lib/reports/labels";
import { periodLabel } from "@/lib/reports/build";
import { createAutomation, runNow } from "@/lib/automations/service";
import { describeAction } from "@/lib/actions/registry";
import { topNews } from "@/lib/news/data";
import { todayInParis } from "@/lib/dashboard/home";
import { runCheckType, type ToolName } from "@/lib/assistant/tools";
import { listAgendaItems } from "@/lib/agenda/service";
import { addDays, expandOccurrences } from "@/lib/agenda/occurrences";
import { zonedToUtc } from "@/lib/scheduler/recurrence";
import type { PrepareResult, ToolOutcome } from "@/lib/assistant/orchestrator";

const db = () => getSupabaseServerClient();
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/** Résout un nom de client saisi librement ; refuse l'ambiguïté plutôt que de deviner. */
export async function resolveClient(name: string): Promise<{ ok: true; id: string; name: string } | { ok: false; message: string }> {
  const query = name.trim().slice(0, 120);
  if (!query) return { ok: false, message: "Précisez le client." };
  const { data, error } = await db().from("clients").select("id,name").ilike("name", `%${escapeLike(query)}%`).order("name").limit(6);
  if (error) throw new Error("client search");
  const rows = data ?? [];
  const exact = rows.find((row) => row.name.localeCompare(query, "fr", { sensitivity: "base" }) === 0);
  if (exact) return { ok: true, id: exact.id, name: exact.name };
  if (rows.length === 1) return { ok: true, id: rows[0].id, name: rows[0].name };
  if (!rows.length) return { ok: false, message: `Aucun client ne correspond à « ${query} ».` };
  return { ok: false, message: `Plusieurs clients correspondent à « ${query} » : ${rows.slice(0, 5).map((row) => row.name).join(", ")}. Précisez lequel.` };
}

/** Vérifie qu'un agent actif du registre détient la capacité (et que ses connexions sont prêtes). */
async function authorizeCapability(capability: CapabilityId): Promise<{ ok: true } | { ok: false; message: string }> {
  const definition = Object.values(agentDefinitions).find((item) => item.capabilities.includes(capability));
  if (!definition) return { ok: false, message: "Capacité non disponible." };
  const agent = await getAgentByType(definition.type);
  if (!agent || !isAgentType(agent.agent_type)) return { ok: false, message: `${definition.name} n’est pas installé.` };
  const decision = authorize({ agent: { type: agent.agent_type, enabled: agent.enabled, status: agent.status, autonomy: agent.autonomy_level }, capability, isProviderConfigured });
  return decision.outcome === "deny" ? { ok: false, message: decision.message } : { ok: true };
}

const count = async (query: PromiseLike<{ count: number | null; error: unknown }>) => {
  const { count: value, error } = await query;
  return error ? null : value ?? 0;
};

export async function executeTool(actor: Actor, name: ToolName, input: Record<string, unknown>): Promise<ToolOutcome> {
  const today = todayInParis();
  switch (name) {
    case "get_priorities": {
      const [actions, incidents, overdue, dueToday, reports] = await Promise.all([
        count(db().from("actions").select("id", { count: "exact", head: true }).eq("status", "pending_approval")),
        count(db().from("incidents").select("id", { count: "exact", head: true }).neq("status", "resolved")),
        count(db().from("tasks").select("id", { count: "exact", head: true }).neq("status", "Terminé").lt("due_date", today)),
        count(db().from("tasks").select("id", { count: "exact", head: true }).neq("status", "Terminé").eq("due_date", today)),
        count(db().from("reports").select("id", { count: "exact", head: true }).eq("status", "ready_for_review")),
      ]);
      const parts = [
        actions ? `${actions} action(s) à valider` : null, incidents ? `${incidents} incident(s) ouvert(s)` : null,
        overdue ? `${overdue} tâche(s) en retard` : null, dueToday ? `${dueToday} tâche(s) pour aujourd’hui` : null, reports ? `${reports} rapport(s) à relire` : null,
      ].filter(Boolean);
      return { ok: true, text: parts.length ? `À traiter : ${parts.join(", ")}.` : "Rien d’urgent pour le moment.", links: [{ label: "Ouvrir Travail", href: "/work?view=review" }, ...(reports ? [{ label: "Rapports à relire", href: "/reports?status=ready_for_review" }] : [])] };
    }
    case "client_overview": {
      const client = await resolveClient(String(input.client));
      if (!client.ok) return { ok: false, text: client.message };
      const [services, tasks, incidents, report] = await Promise.all([
        db().from("client_services").select("service_type,lifecycle").eq("client_id", client.id).limit(20),
        count(db().from("tasks").select("id", { count: "exact", head: true }).eq("client_id", client.id).neq("status", "Terminé")),
        count(db().from("incidents").select("id", { count: "exact", head: true }).eq("client_id", client.id).neq("status", "resolved")),
        db().from("reports").select("kind,status,period_start,period_end").eq("client_id", client.id).order("period_start", { ascending: false }).limit(1).maybeSingle(),
      ]);
      const active = (services.data ?? []).filter((item) => (item as { lifecycle?: string }).lifecycle !== "ended").map((item) => item.service_type);
      const lastReport = report.data ? `dernier rapport : ${periodLabel(report.data.kind, { start: report.data.period_start, end: report.data.period_end })} (${reportStatusLabels[report.data.status].label.toLowerCase()})` : "aucun rapport";
      return { ok: true, text: `${client.name} — services : ${active.length ? active.join(", ") : "aucun"} ; ${tasks ?? "?"} tâche(s) ouverte(s) ; ${incidents ?? 0} incident(s) ouvert(s) ; ${lastReport}.`, links: [{ label: `Fiche ${client.name}`, href: `/clients/${client.id}` }] };
    }
    case "agenda_today": {
      const day = typeof input.date === "string" ? input.date : today;
      const [y, m, d] = day.split("-").map(Number);
      const [ny, nm, nd] = addDays(day, 1).split("-").map(Number);
      const from = zonedToUtc(y, m, d, 0, 0, "Europe/Paris"), to = zonedToUtc(ny, nm, nd, 0, 0, "Europe/Paris");
      const [tasks, agendaItems] = await Promise.all([
        db().from("tasks").select("title,due_time,client:clients(name)").eq("due_date", day).neq("status", "Terminé").order("due_time").limit(20),
        listAgendaItems(to).catch(() => []),
      ]);
      const items = { data: expandOccurrences(agendaItems, from, to).map((occurrence) => ({ title: occurrence.item.title, starts_at: occurrence.startsAt.toISOString() })) };
      const lines = [
        ...(items.data ?? []).map((item) => `${new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(new Date(item.starts_at))} ${item.title}`),
        ...(tasks.data ?? []).map((task) => `${task.due_time ? `${String(task.due_time).slice(0, 5)} ` : ""}${task.title}${(task.client as { name?: string } | null)?.name ? ` (${(task.client as { name: string }).name})` : ""}`),
      ];
      return { ok: true, text: lines.length ? `Au programme : ${lines.slice(0, 10).join(" · ")}.` : "Rien de planifié pour cette journée.", links: [{ label: "Ouvrir l’agenda", href: "/agenda" }] };
    }
    case "list_reports": {
      const allowed = await authorizeCapability("aggregate_activity");
      if (!allowed.ok) return { ok: false, text: allowed.message };
      let clientId: string | undefined;
      if (typeof input.client === "string") {
        const client = await resolveClient(input.client);
        if (!client.ok) return { ok: false, text: client.message };
        clientId = client.id;
      }
      const reports = (await listReports({ clientId })).slice(0, 5);
      if (!reports.length) return { ok: true, text: "Aucun rapport pour l’instant.", links: [{ label: "Rapports", href: "/reports" }] };
      return { ok: true, text: reports.map((report) => `${report.client?.name ?? "Global"} — ${periodLabel(report.kind, { start: report.period_start, end: report.period_end })} : ${reportStatusLabels[report.status].label.toLowerCase()}`).join(" · "), links: reports.slice(0, 3).map((report) => ({ label: `Rapport ${report.client?.name ?? ""}`.trim(), href: `/reports/${report.id}` })) };
    }
    case "list_news": {
      const news = await topNews(3);
      return { ok: true, text: news.length ? news.map((item) => `${item.title} (${item.source})`).join(" · ") : "Aucune actualité collectée : lancez la veille tech & IA.", links: news.flatMap((item) => (item.url ? [{ label: item.source, href: item.url }] : [])) };
    }
    case "generate_report": {
      const allowed = await authorizeCapability("generate_report");
      if (!allowed.ok) return { ok: false, text: allowed.message };
      const client = await resolveClient(String(input.client));
      if (!client.ok) return { ok: false, text: client.message };
      const result = await generateReport(actor, { clientId: client.id, kind: input.kind === "monthly" ? "monthly" : "weekly", today });
      if (result.status === "frozen") return { ok: false, text: "Ce rapport a déjà été envoyé ou archivé : il n’est pas régénéré.", links: [{ label: "Voir le rapport", href: `/reports/${result.id}` }] };
      return { ok: true, text: `Rapport ${result.status === "created" ? "généré" : `régénéré (v${result.version})`} pour ${client.name}. Il attend votre relecture avant tout envoi.`, links: [{ label: "Relire le rapport", href: `/reports/${result.id}` }] };
    }
    case "run_check": {
      const runType = runCheckType(input.check);
      if (!runType) return { ok: false, text: "Analyse inconnue." };
      const definition = runTypes[runType];
      const allowed = await authorizeCapability(definition.capability);
      if (!allowed.ok) return { ok: false, text: allowed.message };
      let clientId: string | null = null;
      if (typeof input.client === "string") {
        const client = await resolveClient(input.client);
        if (!client.ok) return { ok: false, text: client.message };
        clientId = client.id;
      } else if (definition.scope === "client") return { ok: false, text: "Précisez le client pour cette analyse." };
      const result = await runNow(actor, { runType, clientId, trigger: "assistant" });
      return { ok: result.ok, text: result.message ?? (result.ok ? "Analyse lancée." : "Analyse impossible."), links: [{ label: "Observabilité", href: "/settings?tab=system" }, { label: "Travail", href: "/work" }] };
    }
    case "list_pending_actions": {
      const { data, error } = await db().from("actions").select("action_type,parameters,client:clients(name)").eq("status", "pending_approval").order("created_at", { ascending: false }).limit(6);
      if (error) throw new Error("actions read");
      if (!data?.length) return { ok: true, text: "Aucune action en attente de validation.", links: [{ label: "Travail", href: "/work" }] };
      return { ok: true, text: `${data.length} action(s) à valider : ${data.slice(0, 5).map((item) => `${(item.client as { name?: string } | null)?.name ?? "Client"} — ${describeAction(item.action_type, item.parameters)}`).join(" · ")}`, links: [{ label: "Valider dans Travail", href: "/work?view=review" }] };
    }
    case "clients_attention": {
      const [incidents, tasks, actions] = await Promise.all([
        db().from("incidents").select("client_id").neq("status", "resolved").limit(500),
        db().from("tasks").select("client_id").neq("status", "Terminé").lt("due_date", today).limit(500),
        db().from("actions").select("client_id").eq("status", "pending_approval").limit(500),
      ]);
      const score = new Map<string, { incidents: number; overdue: number; actions: number }>();
      const bump = (rows: { client_id: string | null }[] | null, key: "incidents" | "overdue" | "actions") => { for (const row of rows ?? []) { if (!row.client_id) continue; const entry = score.get(row.client_id) ?? { incidents: 0, overdue: 0, actions: 0 }; entry[key]++; score.set(row.client_id, entry); } };
      bump(incidents.data, "incidents"); bump(tasks.data, "overdue"); bump(actions.data, "actions");
      if (!score.size) return { ok: true, text: "Aucun client ne demande d’attention particulière.", links: [{ label: "Clients", href: "/clients" }] };
      const ranked = [...score.entries()].sort(([, a], [, b]) => (b.incidents * 3 + b.overdue * 2 + b.actions) - (a.incidents * 3 + a.overdue * 2 + a.actions)).slice(0, 5);
      const { data: clients } = await db().from("clients").select("id,name").in("id", ranked.map(([id]) => id));
      const name = (id: string) => clients?.find((client) => client.id === id)?.name ?? "Client";
      return { ok: true, text: ranked.map(([id, entry]) => `${name(id)} : ${[entry.incidents ? `${entry.incidents} incident(s)` : null, entry.overdue ? `${entry.overdue} tâche(s) en retard` : null, entry.actions ? `${entry.actions} action(s) à valider` : null].filter(Boolean).join(", ")}`).join(" · "), links: ranked.slice(0, 3).map(([id]) => ({ label: name(id), href: `/clients/${id}` })) };
    }
    case "schedule_check": {
      const runType = runCheckType(input.check);
      if (!runType) return { ok: false, text: "Analyse inconnue." };
      if (actor.kind === "system") return { ok: false, text: "Planification réservée à l’administrateur." };
      const allowed = await authorizeCapability(runTypes[runType].capability);
      let clientId: string | null = null, clientName = "";
      if (typeof input.client === "string") {
        const client = await resolveClient(input.client);
        if (!client.ok) return { ok: false, text: client.message };
        clientId = client.id; clientName = client.name;
      }
      const result = await createAutomation(actor, { name: `${runTypes[runType].label}${clientName ? ` — ${clientName}` : ""} (planifiée)`.slice(0, 120), runType, clientId, frequency: "once", schedule: { runAtLocal: `${input.date}T${input.time}` }, config: {} });
      if (!result.ok) return { ok: false, text: result.message };
      return { ok: true, text: `Planifié le ${input.date} à ${input.time}.${allowed.ok ? "" : ` Attention : ${allowed.message}`}`, links: [{ label: "Automatisations", href: "/settings?tab=automations" }, { label: "Agenda", href: "/agenda" }] };
    }
    case "create_task": {
      const client = await resolveClient(String(input.client));
      if (!client.ok) return { ok: false, text: client.message };
      const { data, error } = await db().from("tasks").insert({
        client_id: client.id, title: String(input.title).slice(0, 200), status: "À faire", priority: String(input.priority ?? "Moyenne"),
        due_date: typeof input.due_date === "string" ? input.due_date : null,
        due_time: typeof input.due_date === "string" && typeof input.due_time === "string" ? input.due_time : null, assignee_type: "admin",
      }).select("id").single();
      if (error || !data) throw new Error("task insert");
      await writeAudit(actor, { action: "task.created", resource_type: "task", resource_id: data.id, metadata: { client_id: client.id, via: "assistant" } });
      return { ok: true, text: `Tâche créée pour ${client.name}.`, links: [{ label: "Voir la tâche", href: `/tasks/${data.id}/edit` }] };
    }
  }
}

/**
 * Vérifie une écriture AVANT de la proposer : client existant et non ambigu (nom canonique repris),
 * échéance non passée. Sinon, une question de précision est renvoyée et rien n'est proposé.
 */
export async function prepareProposal(name: ToolName, input: Record<string, unknown>): Promise<PrepareResult> {
  const next = { ...input };
  if (typeof input.client === "string") {
    const client = await resolveClient(input.client);
    if (!client.ok) return { ok: false, question: `${client.message} Précisez le client.` };
    next.client = client.name;
  }
  const today = todayInParis();
  for (const key of ["due_date", "date"] as const) {
    if (typeof input[key] === "string" && (input[key] as string) < today) return { ok: false, question: `La date ${input[key]} est passée. Quelle date souhaitez-vous ?` };
  }
  if (name === "create_task" && typeof input.due_time === "string" && typeof input.due_date !== "string") return { ok: false, question: `Pour quel jour à ${input.due_time} ?` };
  return { ok: true, input: next };
}
