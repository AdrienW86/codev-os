import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isBlockedBy, normalizeEmail, type SuppressionScope } from "@/lib/emailing/policy";
import { DEFAULT_OUTREACH_TEMPLATE, HANDOFF_STAGES, draftMessage, selectHandoffProspects, templateVars, type HandoffFilter, type HandoffProspect, type HandoffSkip } from "./outreach";

function db(): SupabaseClient { return getSupabaseServerClient() as unknown as SupabaseClient; }

export type HandoffOutcome =
  | { ok: true; created: number; skipped: Record<HandoffSkip, number> }
  | { ok: false; reason: "workspace_missing" | "schema_missing" | "template_missing" | "storage" | "nothing_to_send" };

/**
 * Transmet une liste de prospects à la prospection e-mail : un brouillon par fiche disposant
 * d'une adresse générique, hors exclusions (désabonnements, rebonds, plaintes). Aucun envoi :
 * chaque brouillon reste soumis à approbation et aux verrous de l'espace.
 */
export async function handoffToEmailProspecting(input: { workspaceId: string; filter: HandoffFilter; templateId?: string; limit?: number }): Promise<HandoffOutcome> {
  const client = db();
  const { data: workspace, error } = await client.from("acquisition_workspaces").select("id,client_id,label").eq("id", input.workspaceId).maybeSingle();
  if (error || !workspace) return { ok: false, reason: "workspace_missing" };

  let template: { subject: string; body: string } = DEFAULT_OUTREACH_TEMPLATE;
  if (input.templateId) {
    const { data: t } = await client.from("acquisition_templates").select("subject_template,body_template").eq("id", input.templateId).eq("workspace_id", workspace.id).maybeSingle();
    if (!t) return { ok: false, reason: "template_missing" };
    template = { subject: t.subject_template, body: t.body_template };
  }

  let sender = { name: workspace.label as string, activity: null as string | null };
  if (workspace.client_id) {
    const { data: c } = await client.from("clients").select("name,company_name,activity").eq("id", workspace.client_id).maybeSingle();
    if (c) sender = { name: c.company_name || c.name || sender.name, activity: c.activity ?? null };
  }

  const { data: prospects, error: prospectsError } = await client.from("acquisition_prospects")
    .select("id,company_name,category,stage,score,segment,city,contact_email").eq("workspace_id", workspace.id)
    .in("stage", [...HANDOFF_STAGES]).not("contact_email", "is", null).limit(5000);
  if (prospectsError) return { ok: false, reason: "schema_missing" };
  const list = (prospects ?? []) as HandoffProspect[];

  const { data: messages, error: messagesError } = await client.from("acquisition_messages").select("prospect_id,recipient_email").eq("workspace_id", workspace.id).limit(10000);
  if (messagesError) return { ok: false, reason: "schema_missing" };
  const drafted = new Set((messages ?? []).map((m: { prospect_id: string }) => m.prospect_id));
  const usedEmails = new Set((messages ?? []).map((m: { recipient_email: string }) => normalizeEmail(m.recipient_email)).filter((e): e is string => Boolean(e)));

  const emails = [...new Set(list.map((p) => normalizeEmail(p.contact_email)).filter((e): e is string => Boolean(e)))];
  const { data: local } = await client.from("acquisition_suppressions").select("email_normalized").eq("workspace_id", workspace.id).limit(10000);
  const blocked = new Set((local ?? []).map((r: { email_normalized: string }) => r.email_normalized));
  // Liste d'exclusion commune (désabonnements, rebonds, plaintes), si le socle emailing est en place.
  const scope: SuppressionScope = workspace.client_id ? { scope: "client", clientId: workspace.client_id } : { scope: "codev" };
  for (let i = 0; i < emails.length; i += 200) {
    const { data: rows, error: suppressionError } = await client.from("email_suppressions").select("email_normalized,scope,client_id").in("email_normalized", emails.slice(i, i + 200));
    if (suppressionError) break; // table absente : migration emailing non appliquée, exclusions locales seules
    const byEmail = new Map<string, { scope: string; client_id: string | null }[]>();
    for (const r of (rows ?? []) as { email_normalized: string; scope: string; client_id: string | null }[]) byEmail.set(r.email_normalized, [...(byEmail.get(r.email_normalized) ?? []), r]);
    for (const [email, rs] of byEmail) if (isBlockedBy(rs, scope)) blocked.add(email);
  }

  const { selected, skipped } = selectHandoffProspects(list, input.filter, {
    draftedProspectIds: drafted, usedEmails, isSuppressed: (email) => blocked.has(email), limit: input.limit,
  });
  if (!selected.length) return { ok: false, reason: "nothing_to_send" };

  const rows = selected.map((p) => {
    const draft = draftMessage(template, templateVars(p, sender));
    return { workspace_id: workspace.id, prospect_id: p.id, recipient_email: p.email, subject: draft.subject, body_text: draft.body, state: "draft" };
  });
  const { error: insertError } = await client.from("acquisition_messages").insert(rows);
  if (insertError) return { ok: false, reason: "storage" };
  await client.from("acquisition_prospects").update({ stage: "draft_ready", updated_at: new Date().toISOString() })
    .eq("workspace_id", workspace.id).in("id", selected.map((p) => p.id));
  return { ok: true, created: rows.length, skipped };
}
