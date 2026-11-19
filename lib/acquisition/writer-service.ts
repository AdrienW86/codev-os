import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { withCharter } from "@/lib/harness/charter";
import { structuredResponse, withAiScope } from "@/lib/ai/metered";
import { agentsAiConfigured } from "@/lib/ai/models";
import { safeFetchPage } from "./safe-fetch";
import { robotsAllows } from "./website";
import { PRESCRIBER_SEGMENTS, type PrescriberSegmentId } from "./prescribers";
import { templateVars } from "./outreach";
import { WRITER_INSTRUCTIONS, WRITER_SCHEMA, extractPageFacts, validateWriterOutput, writerInput, type WriterContext, type WriterFact } from "./writer";

// Agent Rédacteur prospection (étape acquisition_writer) : réécrit en tâche de fond les brouillons demandés en
// « rédaction personnalisée ». Faits lus sur la page publique de l'entreprise (robots.txt respecté) et dans sa fiche ;
// une sortie refusée par le contrôle laisse le brouillon du modèle de base, jamais un texte non vérifié.
const db = () => getSupabaseServerClient() as unknown as SupabaseClient;
const PER_TICK = 4;
const PER_DRAFT_MS = 45_000;

type Draft = { id: string; workspace_id: string; prospect_id: string };
type Prospect = { company_name: string; city: string | null; segment: string | null; category: string; contact_email_source: string | null; website: string | null; places_website: string | null; osm_website: string | null; source_url: string | null; source_checked_at: string | null };

async function pageFacts(url: string | null, now: Date): Promise<WriterFact[]> {
  if (!url) return [];
  try {
    const page = new URL(url);
    const robots = await safeFetchPage(new URL("/robots.txt", page).toString()).catch(() => null);
    if (!robotsAllows(robots?.ok ? robots.text.slice(0, 50_000) : null, page.pathname || "/")) return [];
    const res = await safeFetchPage(page.toString());
    return res?.ok ? extractPageFacts(res.text.slice(0, 600_000), res.finalUrl, now.toISOString()) : [];
  } catch { return []; }
}

async function writeOne(draft: Draft, now: Date): Promise<"written" | "template"> {
  const [{ data: prospect }, { data: workspace }] = await Promise.all([
    db().from("acquisition_prospects").select("company_name,city,segment,category,contact_email_source,website,places_website,osm_website,source_url,source_checked_at").eq("id", draft.prospect_id).maybeSingle(),
    db().from("acquisition_workspaces").select("client_id,label").eq("id", draft.workspace_id).maybeSingle(),
  ]);
  const p = prospect as Prospect | null, w = workspace as { client_id: string | null; label: string } | null;
  if (!p || !w) return "template";
  let sender = { name: w.label, activity: null as string | null, zone: null as string | null };
  if (w.client_id) {
    const { data: c } = await db().from("clients").select("name,company_name,activity,geographic_area").eq("id", w.client_id).maybeSingle();
    if (c) sender = { name: c.company_name || c.name || w.label, activity: c.activity ?? null, zone: c.geographic_area ?? null };
  }
  const facts: WriterFact[] = [];
  const segment = p.segment && Object.hasOwn(PRESCRIBER_SEGMENTS, p.segment) ? PRESCRIBER_SEGMENTS[p.segment as PrescriberSegmentId].label : null;
  if (segment && p.source_url) facts.push({ id: "registry_activity", label: "Activité au registre", statement: `${p.company_name} est enregistrée comme ${segment.toLocaleLowerCase("fr")}${p.city ? ` à ${p.city}` : ""}.`, sourceUrl: p.source_url, verifiedAt: p.source_checked_at ?? now.toISOString() });
  facts.push(...await pageFacts(p.contact_email_source ?? p.website ?? p.places_website ?? p.osm_website, now));
  if (!facts.length) return "template";
  const ctx: WriterContext = {
    sender, recipient: { company: p.company_name, city: p.city, segment }, facts,
    benefit: templateVars({ id: draft.prospect_id, company_name: p.company_name, category: p.category, stage: "draft_ready", score: null, segment: p.segment, city: p.city }, { name: sender.name, activity: sender.activity }).benefice,
  };
  const call = () => structuredResponse(withCharter("prospection-writer", WRITER_INSTRUCTIONS), writerInput(ctx), WRITER_SCHEMA, { maxOutputTokens: 900, timeoutMs: PER_DRAFT_MS, agent: "prospection-writer", ...(w.client_id ? { clientId: w.client_id } : {}) });
  let verdict;
  try { verdict = validateWriterOutput((w.client_id ? await withAiScope({ agent: "prospection-writer", clientId: w.client_id }, call) : await call()).value, ctx); }
  catch { verdict = { ok: false as const, reason: "ai_unavailable" }; }
  const at = now.toISOString();
  if (!verdict.ok) {
    await db().from("acquisition_messages").update({ draft_source: "template", last_error: `writer_${verdict.reason}`.slice(0, 60), updated_at: at }).eq("id", draft.id).eq("state", "draft").eq("draft_source", "ai_pending");
    return "template";
  }
  await db().from("acquisition_messages").update({
    subject: verdict.subject, body_text: verdict.body, draft_source: "ai", last_error: null, updated_at: at,
    facts: verdict.facts.map((f) => ({ label: f.label, statement: f.statement, sourceUrl: f.sourceUrl, verifiedAt: f.verifiedAt })),
  }).eq("id", draft.id).eq("state", "draft").eq("draft_source", "ai_pending");
  return "written";
}

export async function runProspectingWriterTick(options: { deadline: number; now?: Date }): Promise<{ written: number; template: number; disabled?: true }> {
  if (!agentsAiConfigured()) return { written: 0, template: 0, disabled: true };
  const { data, error } = await db().from("acquisition_messages").select("id,workspace_id,prospect_id").eq("state", "draft").eq("draft_source", "ai_pending").order("created_at", { ascending: true }).limit(PER_TICK);
  if (error) return { written: 0, template: 0, disabled: true }; // migration 20261220000000 non appliquée
  const result = { written: 0, template: 0 };
  for (const draft of (data ?? []) as Draft[]) {
    if (options.deadline - Date.now() < PER_DRAFT_MS + 5_000) break;
    result[await writeOne(draft, options.now ?? new Date())]++;
  }
  return result;
}
