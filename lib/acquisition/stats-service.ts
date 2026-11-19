import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { prospectingStats, type ProspectingStats, type StatsEvent, type StatsMessage } from "./stats";

// Résultats des 90 derniers jours par espace (onglet E-mails). null si l'envoi n'est pas installé (migration 20261220000000).
const db = () => getSupabaseServerClient() as unknown as SupabaseClient;

export async function getProspectingStats(): Promise<Record<string, ProspectingStats> | null> {
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const { data, error } = await db().from("acquisition_messages").select("workspace_id,state,step,sent_at,replied_at,reply_kind,provider_message_id").gte("created_at", since).limit(10_000);
  if (error) return null;
  const messages = (data ?? []) as (StatsMessage & { workspace_id: string })[];
  const ids = [...new Set(messages.map((m) => m.provider_message_id).filter((id): id is string => Boolean(id)))];
  const events: StatsEvent[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const res = await db().from("email_events").select("provider_message_id,event_type,detail").in("provider_message_id", ids.slice(i, i + 200)).in("event_type", ["email.delivered", "email.bounced", "email.complained"]);
    if (res.error) break; // événements illisibles : rebonds et plaintes affichés à 0, jamais estimés
    events.push(...(res.data ?? []) as StatsEvent[]);
  }
  const byWorkspace = new Map<string, StatsMessage[]>();
  for (const m of messages) byWorkspace.set(m.workspace_id, [...(byWorkspace.get(m.workspace_id) ?? []), m]);
  return Object.fromEntries([...byWorkspace].map(([id, rows]) => [id, prospectingStats(rows, events)]));
}
