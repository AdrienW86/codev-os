import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { withCharter } from "@/lib/harness/charter";
import { structuredResponse } from "@/lib/integrations/publications-openai";
import { oauthBaseUrl } from "@/lib/integrations/publications-oauth/config";
import { clientBrandContext } from "@/lib/visual-agent/service";
import { articleUrl, blogSettingsFromRow, normalizeSiteUrl } from "@/lib/blog-agent/model";
import { emailSendingStatus, sendEmail } from "@/lib/providers/email";
import { writeAudit } from "@/lib/core/audit";
import type { Actor } from "@/lib/core/actor";
import { UNSUBSCRIBE_PATH, isBlockedBy, normalizeEmail, unsubscribeHeaders, unsubscribeToken } from "./policy";
import {
  NEWSLETTER_INSTRUCTIONS, NEWSLETTER_SCHEMA, auditNewsletter, checkNewsletter, renderNewsletter, sourceFacts,
  type NewsletterContent, type NewsletterSource,
} from "./newsletter";
import { parseContactLines, type ConsentBasis } from "./contacts";

// Agent Newsletter : rédaction à partir des seuls faits vérifiés du client, approbation humaine obligatoire, envoi aux
// contacts consentants hors liste d'exclusion, par lots reprenables (journal écrit avant chaque appel au fournisseur).
// Tables de la migration 20261206000000_email_newsletters.sql : client non typé (même approche que le socle emailing).
const db = () => getSupabaseServerClient() as unknown as SupabaseClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SEND_BATCH = 100;

type Outcome = { ok: boolean; message: string };
export type NewsletterRow = {
  id: string; client_id: string; status: "draft" | "approved" | "sending" | "sent" | "cancelled"; subject: string; preheader: string;
  content: NewsletterContent; sources: NewsletterSource[]; audit: { score?: number; words?: number; issues?: { level: string; code: string; message: string }[] };
  sent_count: number; failed_count: number; skipped_count: number; approved_at: string | null; sent_at: string | null; created_at: string;
};
const COLUMNS = "id,client_id,status,subject,preheader,content,sources,audit,sent_count,failed_count,skipped_count,approved_at,sent_at,created_at";

export type NewsletterView = { ready: boolean; newsletters: NewsletterRow[]; contacts: { subscribed: number; other: number }; sources: NewsletterSource[]; sending: { enabled: boolean; reason: string | null } };

/** Faits citables : articles publiés (90 jours, adresse publique), prestations confirmées, profil. */
async function gatherSources(clientId: string): Promise<{ sources: NewsletterSource[]; client: { name: string; activity: string | null; zone: string | null }; facts: string; site: string | null }> {
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  const [ctx, agent, articles, client] = await Promise.all([
    clientBrandContext(clientId),
    db().from("client_blog_agents").select("*").eq("client_id", clientId).maybeSingle(),
    db().from("blog_articles").select("slug,title,excerpt,published_at").eq("client_id", clientId).eq("status", "published").gte("published_at", since).order("published_at", { ascending: false }).limit(6),
    db().from("clients").select("website").eq("id", clientId).maybeSingle(),
  ]);
  const settings = blogSettingsFromRow((agent.data as Record<string, unknown> | null) ?? null);
  const site = settings.siteUrl ?? normalizeSiteUrl((client.data as { website?: unknown } | null)?.website);
  const sources: NewsletterSource[] = [
    ...((articles.data ?? []) as { slug: string; title: string; excerpt: string }[]).map((a) => ({
      kind: "article" as const, title: a.title, summary: a.excerpt, url: settings.siteUrl ? articleUrl(settings.siteUrl, settings.blogPath, a.slug) : null,
    })),
    ...ctx.services.slice(0, 8).map((s) => ({ kind: "service" as const, title: s, summary: `Prestation proposée par ${ctx.client.name}.`, url: null })),
  ];
  return { sources, client: ctx.client, facts: ctx.facts, site };
}

export async function getNewsletterView(clientId: string): Promise<NewsletterView> {
  if (!UUID.test(clientId)) throw new Error("invalid client");
  const [list, contacts, gathered] = await Promise.all([
    db().from("email_newsletters").select(COLUMNS).eq("client_id", clientId).order("created_at", { ascending: false }).limit(20),
    db().from("email_contacts").select("status").eq("client_id", clientId).limit(20000),
    gatherSources(clientId).catch(() => null),
  ]);
  const sending = emailSendingStatus();
  const rows = (contacts.data ?? []) as { status: string }[];
  return {
    ready: !list.error, newsletters: (list.data ?? []) as NewsletterRow[],
    contacts: { subscribed: rows.filter((r) => r.status === "subscribed").length, other: rows.filter((r) => r.status !== "subscribed").length },
    sources: gathered?.sources ?? [], sending: { enabled: sending.enabled, reason: sending.enabled ? null : sending.reason },
  };
}

/** Rédige un brouillon (deux essais au plus, le second avec le motif du refus). Aucun envoi. */
export async function generateNewsletter(actor: Actor & { kind: "admin" }, clientId: string): Promise<Outcome> {
  if (!UUID.test(clientId)) return { ok: false, message: "Client invalide." };
  if (!process.env.OPENAI_API_KEY) return { ok: false, message: "IA non configurée (OPENAI_API_KEY) : rédaction impossible." };
  const { sources, client, facts, site } = await gatherSources(clientId);
  if (!sources.length) return { ok: false, message: "Aucun fait à raconter : publiez un article ou confirmez des prestations du client d'abord." };
  const allowedUrls = [...sources.map((s) => s.url).filter((u): u is string => Boolean(u)), ...(site ? [site] : [])];
  const allFacts = sourceFacts(sources, client, facts);
  const previous = await db().from("email_newsletters").select("subject").eq("client_id", clientId).order("created_at", { ascending: false }).limit(12);
  if (previous.error) return { ok: false, message: "Migration Newsletters non appliquée." };
  let feedback: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let value: unknown;
    try {
      ({ value } = await structuredResponse(withCharter("newsletter", NEWSLETTER_INSTRUCTIONS), JSON.stringify({
        client: client.name, activity: client.activity, zone: client.zone, month: new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "Europe/Paris" }),
        sources, site_url: site, facts_untrusted: facts.slice(0, 4000), previous_subjects: (previous.data ?? []).map((p: { subject: string }) => p.subject),
        ...(feedback ? { previous_attempt_refused: feedback } : {}),
      }), NEWSLETTER_SCHEMA, { maxOutputTokens: 2500, timeoutMs: 90000 }));
    } catch { return { ok: false, message: "Rédaction indisponible (IA). Réessayez plus tard." }; }
    const checked = checkNewsletter(value, { facts: allFacts, allowedUrls });
    if (!checked.ok) { feedback = checked.reason; continue; }
    const audit = auditNewsletter(checked.content);
    const { data, error } = await db().from("email_newsletters").insert({
      client_id: clientId, subject: checked.content.subject, preheader: checked.content.preheader, content: checked.content, sources, audit, created_by: actor.userId,
    }).select("id").single();
    if (error || !data) return { ok: false, message: "Enregistrement du brouillon impossible." };
    await writeAudit(actor, { action: "newsletter.drafted", resource_type: "email_newsletter", resource_id: data.id, metadata: { client_id: clientId, score: audit.score } });
    return { ok: true, message: `Brouillon rédigé (qualité ${audit.score}/100). Relisez-le avant de l'approuver.` };
  }
  return { ok: false, message: `Brouillon refusé par le contrôle anti-invention (${feedback}). Aucun texte n'a été enregistré.` };
}

async function readNewsletter(id: string): Promise<NewsletterRow | null> {
  if (!UUID.test(id)) return null;
  const { data } = await db().from("email_newsletters").select(COLUMNS).eq("id", id).maybeSingle();
  return (data as NewsletterRow | null) ?? null;
}

export async function approveNewsletter(actor: Actor & { kind: "admin" }, id: string): Promise<Outcome> {
  const row = await readNewsletter(id);
  if (!row || row.status !== "draft") return { ok: false, message: "Seul un brouillon peut être approuvé." };
  const { error } = await db().from("email_newsletters").update({ status: "approved", approved_by: actor.userId, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id).eq("status", "draft");
  if (error) return { ok: false, message: "Approbation impossible." };
  await writeAudit(actor, { action: "newsletter.approved", resource_type: "email_newsletter", resource_id: id, metadata: { client_id: row.client_id } });
  return { ok: true, message: "Newsletter approuvée. Elle part seulement quand vous cliquez sur « Envoyer »." };
}

export async function cancelNewsletter(actor: Actor & { kind: "admin" }, id: string): Promise<Outcome> {
  const row = await readNewsletter(id);
  if (!row || !["draft", "approved"].includes(row.status)) return { ok: false, message: "Cette newsletter ne peut plus être annulée." };
  const { error } = await db().from("email_newsletters").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", id).in("status", ["draft", "approved"]);
  if (error) return { ok: false, message: "Annulation impossible." };
  await writeAudit(actor, { action: "newsletter.cancelled", resource_type: "email_newsletter", resource_id: id, metadata: { client_id: row.client_id } });
  return { ok: true, message: "Newsletter annulée." };
}

/**
 * Envoie un lot (au plus SEND_BATCH destinataires). Premier appel : fige la liste des destinataires (abonnés, hors
 * exclusions). Chaque ligne est écrite avant l'appel au fournisseur, avec une clé d'idempotence : un lot relancé
 * n'envoie jamais deux fois. Relancer « Envoyer » poursuit l'envoi jusqu'au dernier destinataire.
 */
export async function sendNewsletterBatch(actor: Actor & { kind: "admin" }, id: string): Promise<Outcome> {
  const row = await readNewsletter(id);
  if (!row || !["approved", "sending"].includes(row.status) || !row.approved_at) return { ok: false, message: "Seule une newsletter approuvée peut être envoyée." };
  const status = emailSendingStatus();
  if (!status.enabled) return { ok: false, message: status.reason };
  const base = oauthBaseUrl();
  if (!base || !/^https:\/\//.test(base)) return { ok: false, message: "Adresse publique du cockpit (PUBLICATIONS_OAUTH_BASE_URL) manquante : lien de désabonnement impossible, envoi refusé." };
  const target = { scope: "client" as const, clientId: row.client_id };
  const brand = (await db().from("clients").select("name,company_name").eq("id", row.client_id).maybeSingle()).data as { name?: string; company_name?: string | null } | null;
  const brandName = brand?.company_name || brand?.name || "Votre entreprise";

  if (row.status === "approved") {
    const { data: contacts, error } = await db().from("email_contacts").select("email_normalized").eq("client_id", row.client_id).eq("status", "subscribed").limit(20000);
    if (error) return { ok: false, message: "Lecture des contacts impossible." };
    const emails = [...new Set(((contacts ?? []) as { email_normalized: string }[]).map((c) => normalizeEmail(c.email_normalized)).filter((e): e is string => Boolean(e)))];
    if (!emails.length) return { ok: false, message: "Aucun contact abonné pour ce client." };
    const blocked = new Set<string>();
    for (let i = 0; i < emails.length; i += 200) {
      const { data, error: suppressionError } = await db().from("email_suppressions").select("email_normalized,scope,client_id").in("email_normalized", emails.slice(i, i + 200));
      if (suppressionError) return { ok: false, message: "Liste d'exclusion illisible : envoi refusé par prudence." };
      const byEmail = new Map<string, { scope: string; client_id: string | null }[]>();
      for (const r of (data ?? []) as { email_normalized: string; scope: string; client_id: string | null }[]) byEmail.set(r.email_normalized, [...(byEmail.get(r.email_normalized) ?? []), r]);
      for (const [email, rs] of byEmail) if (isBlockedBy(rs, target)) blocked.add(email);
    }
    const rows = emails.map((email) => ({ newsletter_id: id, email_normalized: email, status: blocked.has(email) ? "skipped" : "pending", error: blocked.has(email) ? "suppressed" : null }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error: insertError } = await db().from("email_newsletter_sends").upsert(rows.slice(i, i + 500), { onConflict: "newsletter_id,email_normalized", ignoreDuplicates: true });
      if (insertError) return { ok: false, message: "Préparation des envois impossible." };
    }
    const { error: statusError } = await db().from("email_newsletters").update({ status: "sending", skipped_count: blocked.size, updated_at: new Date().toISOString() }).eq("id", id).eq("status", "approved");
    if (statusError) return { ok: false, message: "Préparation des envois impossible." };
    await writeAudit(actor, { action: "newsletter.sending", resource_type: "email_newsletter", resource_id: id, metadata: { client_id: row.client_id, recipients: emails.length - blocked.size, skipped: blocked.size } });
  }

  const { data: pending, error: pendingError } = await db().from("email_newsletter_sends").select("id,email_normalized").eq("newsletter_id", id).eq("status", "pending").limit(SEND_BATCH);
  if (pendingError) return { ok: false, message: "Lecture des envois impossible." };
  let sent = 0, failed = 0;
  for (const p of (pending ?? []) as { id: string; email_normalized: string }[]) {
    // Dernière vérification juste avant l'envoi : un désabonnement reçu pendant l'envoi est respecté.
    const { data: late } = await db().from("email_suppressions").select("scope,client_id").eq("email_normalized", p.email_normalized).limit(20);
    if (late && isBlockedBy(late as { scope: string; client_id: string | null }[], target)) {
      await db().from("email_newsletter_sends").update({ status: "skipped", error: "suppressed" }).eq("id", p.id).eq("status", "pending");
      continue;
    }
    const token = unsubscribeToken(p.email_normalized, target);
    const headers = unsubscribeHeaders(p.email_normalized, target, base);
    if (!token || !headers) return { ok: false, message: "Clé de désabonnement absente (PUBLICATION_CREDENTIALS_KEY) : envoi refusé." };
    const rendered = renderNewsletter(row.content, { brand: brandName, unsubscribeUrl: `${base}${UNSUBSCRIBE_PATH}?t=${token}` });
    try {
      const result = await sendEmail({ to: p.email_normalized, subject: row.subject, text: rendered.text, html: rendered.html, headers, idempotencyKey: `newsletter:${id}:${p.id}` });
      await db().from("email_newsletter_sends").update({ status: "sent", provider_message_id: result.id, sent_at: new Date().toISOString() }).eq("id", p.id);
      sent++;
    } catch {
      await db().from("email_newsletter_sends").update({ status: "failed", error: "provider_error" }).eq("id", p.id);
      failed++;
    }
  }
  const counts = await db().from("email_newsletter_sends").select("status").eq("newsletter_id", id).limit(20000);
  const all = (counts.data ?? []) as { status: string }[];
  const left = all.filter((r) => r.status === "pending").length;
  const update = {
    sent_count: all.filter((r) => r.status === "sent").length, failed_count: all.filter((r) => r.status === "failed").length,
    skipped_count: all.filter((r) => r.status === "skipped").length, updated_at: new Date().toISOString(),
    ...(left === 0 ? { status: "sent", sent_at: new Date().toISOString() } : {}),
  };
  await db().from("email_newsletters").update(update).eq("id", id);
  await writeAudit(actor, { action: "newsletter.batch_sent", resource_type: "email_newsletter", resource_id: id, metadata: { client_id: row.client_id, sent, failed, left } });
  return { ok: true, message: left ? `${sent} envoyé(s), ${failed} échec(s). Reste ${left} destinataire(s) : cliquez à nouveau sur « Envoyer » pour continuer.` : `Envoi terminé : ${update.sent_count} envoyé(s), ${update.failed_count} échec(s), ${update.skipped_count} exclu(s).` };
}

/** Ajoute des contacts (une adresse par ligne) avec leur base légale ; une adresse déjà connue n'est pas modifiée. */
export async function importContacts(actor: Actor & { kind: "admin" }, clientId: string, text: string, basis: ConsentBasis, source: string): Promise<Outcome> {
  if (!UUID.test(clientId)) return { ok: false, message: "Client invalide." };
  const parsed = parseContactLines(text);
  const consentSource = source.replace(/\s+/g, " ").trim().slice(0, 300);
  if (consentSource.length < 2) return { ok: false, message: "Indiquez l'origine du consentement (ex. formulaire du site, clients 2025)." };
  if (!parsed.emails.length) return { ok: false, message: "Aucune adresse valide." };
  const now = new Date().toISOString();
  const rows = parsed.emails.map((email) => ({ client_id: clientId, email_normalized: email, status: "subscribed", consent_basis: basis, consent_source: consentSource, consent_at: now }));
  let added = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await db().from("email_contacts").upsert(rows.slice(i, i + 500), { onConflict: "client_id,email_normalized", ignoreDuplicates: true }).select("id");
    if (error) return { ok: false, message: "Migration emailing non appliquée ou enregistrement impossible." };
    added += (data ?? []).length;
  }
  await writeAudit(actor, { action: "email_contacts.imported", resource_type: "client", resource_id: clientId, metadata: { added, invalid: parsed.invalid, basis } });
  return { ok: true, message: `${added} contact(s) ajouté(s), ${parsed.emails.length - added} déjà connu(s), ${parsed.invalid} ligne(s) invalide(s).` };
}
