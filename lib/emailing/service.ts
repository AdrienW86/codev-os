import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { oauthBaseUrl } from "@/lib/integrations/publications-oauth/config";
import { isBlockedBy, normalizeEmail, unsubscribeHeaders, type ResendEventEffect, type SuppressionScope } from "@/lib/emailing/policy";

// Accès serveur au socle emailing (migration 20261129000000_emailing_foundation.sql). Les types de base seront générés
// une fois la migration appliquée ; d'ici là, client non typé (même approche que le module Acquisition).
const db = () => getSupabaseServerClient() as unknown as SupabaseClient;
const duplicate = (error: { code?: string } | null) => error?.code === "23505";

type Reason = "unsubscribe" | "hard_bounce" | "complaint" | "manual";

async function addSuppression(email: string, scope: "global" | SuppressionScope["scope"], clientId: string | null, reason: Reason, source: string) {
  const { error } = await db().from("email_suppressions").insert({ scope, client_id: clientId, email_normalized: email, reason, source });
  if (error && !duplicate(error)) throw new Error("email_suppression_failed");
}

/** Désabonnement (lien signé ou en-tête un clic). Idempotent. */
export async function unsubscribe(email: string, target: SuppressionScope, source: "link" | "one_click") {
  const clientId = target.scope === "client" ? target.clientId : null;
  await addSuppression(email, target.scope, clientId, "unsubscribe", source);
  if (clientId) {
    const { error } = await db().from("email_contacts").update({ status: "unsubscribed", unsubscribed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("client_id", clientId).eq("email_normalized", email).in("status", ["pending", "subscribed"]);
    if (error) throw new Error("email_contact_update_failed");
  }
}

/** Consigne un événement du webhook Resend ; rebond définitif ou plainte → exclusion globale. false si déjà reçu. */
export async function recordResendEvent(eventId: string, effect: ResendEventEffect): Promise<boolean> {
  const { error } = await db().from("email_events").insert({
    provider: "resend", provider_event_id: eventId, event_type: effect.type, provider_message_id: effect.providerMessageId,
    email_normalized: effect.emails[0] ?? null, detail: effect.detail, occurred_at: effect.occurredAt,
  });
  if (duplicate(error)) return false;
  if (error) throw new Error("email_event_failed");
  if (effect.suppress) {
    const status = effect.suppress === "complaint" ? "complained" : "bounced";
    for (const email of effect.emails) {
      await addSuppression(email, "global", null, effect.suppress, "resend_webhook");
      const { error: update } = await db().from("email_contacts").update({ status, updated_at: new Date().toISOString() }).eq("email_normalized", email);
      if (update) throw new Error("email_contact_update_failed");
    }
  }
  return true;
}

/** À appeler avant tout envoi en nombre : true si l'adresse ne doit pas recevoir de message de cet expéditeur. */
export async function isSuppressed(rawEmail: string, target: SuppressionScope): Promise<boolean> {
  const email = normalizeEmail(rawEmail);
  if (!email) return true;
  const { data, error } = await db().from("email_suppressions").select("scope,client_id").eq("email_normalized", email).limit(50);
  if (error) throw new Error("email_suppression_read_failed"); // en cas de doute, l'appelant n'envoie pas
  return isBlockedBy((data ?? []) as { scope: string; client_id: string | null }[], target);
}

/** En-têtes de désabonnement d'un envoi en nombre (URL publique du cockpit : PUBLICATIONS_OAUTH_BASE_URL). null si la
 *  configuration manque : l'envoi en nombre doit alors être refusé. */
export function bulkEmailHeaders(email: string, target: SuppressionScope): Record<string, string> | null {
  return unsubscribeHeaders(email, target, oauthBaseUrl());
}
