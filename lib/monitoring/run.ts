import "server-only";
// Handler « monitoring.check_sites » : disponibilité HTTP des sites des clients Maintenance / Site web,
// derniers déploiements Vercel et commits GitHub si connectés. Analyse automatique ;
// toute correction est une ACTION préparée, à valider puis réaliser manuellement.
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { safeGet } from "@/lib/providers/safe-http";
import { ProviderError } from "@/lib/providers/errors";
import { latestDeployment } from "@/lib/providers/vercel";
import { recentCommits } from "@/lib/providers/github";
import { evaluateCheck, siteUrl } from "@/lib/monitoring/evaluate";
import { openIncident, prepareAction, recordRecommendation, resolveIncident } from "@/lib/agents/outputs";
import { RunError, type RunHandler } from "@/lib/runs/types";
import type { Json } from "@/lib/supabase/database.types";

const MAX_SITES = 25;

export const checkSitesRun: RunHandler = async ({ job, agent, actor, now }) => {
  const supabase = getSupabaseServerClient();
  let clientIds: string[];
  if (job.client_id) clientIds = [job.client_id];
  else {
    const { data, error } = await supabase.from("client_services").select("client_id").in("service_key", ["maintenance", "website"]).eq("lifecycle", "active").limit(500);
    if (error) throw new RunError("Services illisibles.");
    clientIds = [...new Set((data ?? []).map((row) => row.client_id))];
  }
  if (!clientIds.length) return { status: "skipped", summary: "Aucun client avec un service Maintenance ou Site web actif." };
  const { data: clients, error } = await supabase.from("clients").select("id,name,website").in("id", clientIds.slice(0, MAX_SITES));
  if (error) throw new RunError("Clients illisibles.");
  const { data: connections } = await supabase.from("client_connections").select("client_id,provider,metadata").in("client_id", clientIds.slice(0, MAX_SITES)).in("provider", ["vercel", "github"]);

  const counts = { up: 0, slow: 0, down: 0, skipped: 0, partial: 0 };
  for (const client of clients ?? []) {
    const url = siteUrl(client.website);
    if (!url) { counts.skipped++; continue; }
    let status: number | null = null, ms: number | null = null, errorKind: string | null = null;
    try { const response = await safeGet(url, { provider: "http", allowHttp: true, timeoutMs: 10_000, maxBytes: 200_000, accept: "text/html,*/*" }); status = response.status; ms = response.ms; }
    catch (failure) { errorKind = failure instanceof ProviderError ? failure.kind : "unavailable"; }
    const verdict = evaluateCheck({ ok: false, status, ms, errorKind });
    await supabase.from("site_checks").insert({ client_id: client.id, url: url.slice(0, 2048), ok: verdict.state === "up" || verdict.state === "slow", status_code: status, response_ms: ms, error_kind: errorKind, details: { verdict: verdict.label } as Json, job_id: job.id });
    if (verdict.state === "blocked") { counts.skipped++; continue; }
    const fingerprint = `site-down:${client.id}`;
    if (verdict.state === "down") {
      counts.down++;
      const incident = await openIncident(actor, { clientId: client.id, agentId: agent.id, source: "monitoring", severity: "high", title: `Site ${new URL(url).hostname} indisponible`, fingerprint, details: { verdict: verdict.label, checked_at: now.toISOString() } });
      if (incident.created) {
        const recommendation = await recordRecommendation(actor, { agentId: agent.id, clientId: client.id, title: `Rétablir la disponibilité de ${new URL(url).hostname}`, reason: `${verdict.label}. Vérifier le dernier déploiement, l’hébergement et le DNS ; revenir à la version précédente si le dernier déploiement est en cause.`, severity: "high", payload: { incident_id: incident.id, url } });
        await supabase.from("incidents").update({ recommendation_id: recommendation.id }).eq("id", incident.id);
        await prepareAction(actor, { recommendationId: recommendation.id, type: "monitoring.fix", parameters: { target: url, fix: "Diagnostiquer puis revenir au dernier déploiement fonctionnel.", rollback: "Redéployer la version actuelle si le retour arrière n’améliore rien." }, incidentId: incident.id });
      }
    } else {
      counts[verdict.state]++;
      await resolveIncident(actor, fingerprint);
    }
    // Sources complémentaires : une panne de fournisseur n'interrompt pas le contrôle (panne partielle).
    for (const connection of (connections ?? []).filter((item) => item.client_id === client.id)) {
      const metadata = (connection.metadata ?? {}) as { project_id?: string; repository?: string };
      try {
        if (connection.provider === "vercel" && metadata.project_id) {
          const deployment = await latestDeployment(metadata.project_id);
          if (deployment?.state === "ERROR") await openIncident(actor, { clientId: client.id, agentId: agent.id, source: "monitoring", severity: "medium", title: "Dernier déploiement Vercel en échec", fingerprint: `vercel-error:${client.id}:${deployment.id}`, details: { deployment: deployment.id } });
        }
        if (connection.provider === "github" && metadata.repository) {
          const commits = await recentCommits(metadata.repository);
          const today = now.toISOString().slice(0, 10);
          await supabase.from("metric_snapshots").upsert({ client_id: client.id, provider: "github", metric_key: "recent_commits", period_start: today, period_end: today, data: { commits } as unknown as Json }, { onConflict: "client_id,provider,metric_key,period_start,period_end" });
        }
      } catch { counts.partial++; }
    }
  }
  const parts = [`${counts.up} en ligne`, counts.slow ? `${counts.slow} lent(s)` : null, counts.down ? `${counts.down} indisponible(s)` : null, counts.skipped ? `${counts.skipped} sans adresse contrôlable` : null, counts.partial ? `${counts.partial} source(s) complémentaire(s) indisponible(s)` : null].filter(Boolean);
  return { status: "succeeded", summary: `Contrôle de ${(clients ?? []).length} site(s) : ${parts.join(", ")}.`, data: counts };
};
