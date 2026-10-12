import "server-only";
// Conversation avec l'Agent SEO sur une recommandation liée à une opportunité : données réelles (Search Console),
// IA facultative (fournisseur configuré), réponse enregistrée dans la conversation existante (agent_messages).
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { selectAIProvider } from "@/lib/ai/providers";
import { searchAnalytics } from "@/lib/providers/search-console";
import { searchConsoleAccess } from "@/lib/integrations/search-console/connection";
import { normalizeProperty } from "@/lib/integrations/search-console/model";
import { createAgentMessage } from "@/lib/agent-messages/data";
import { replyToMessage, type ConversationDeps } from "@/lib/seo/opportunity-assistant";
import { todayInParis } from "@/lib/dashboard/home";
import type { SeoOpportunityRow } from "@/lib/supabase/seo-opportunities.types";
import type { ChatMessage } from "@/lib/ai/types";

/** Répond au message de l'administrateur si la recommandation est une opportunité de l'Agent SEO ; sinon ne fait rien. */
export async function answerOpportunityMessage(recommendationId: string, message: string, simulation: boolean) {
  const db = getSupabaseServerClient();
  const { data: opportunity } = await db.from("seo_keyword_opportunities").select("*").eq("recommendation_id", recommendationId).maybeSingle();
  if (!opportunity) return null;
  const row = opportunity as SeoOpportunityRow;
  const [{ data: client }, { data: connection }, { data: history }] = await Promise.all([
    db.from("clients").select("name").eq("id", row.client_id).maybeSingle(),
    db.from("client_connections").select("metadata").eq("client_id", row.client_id).eq("provider", "search-console").maybeSingle(),
    db.from("agent_messages").select("sender_type,message").eq("recommendation_id", recommendationId).order("created_at", { ascending: false }).limit(8),
  ]);
  const property = normalizeProperty((connection?.metadata as { property?: unknown } | null)?.property);
  const access = property && !simulation ? await searchConsoleAccess().catch(() => null) : null;
  const deps: ConversationDeps = {
    provider: simulation ? null : selectAIProvider(),
    today: todayInParis(),
    search: access && property ? (period, filters, dimensions) => searchAnalytics(property, { startDate: period.start, endDate: period.end, dimensions, rowLimit: 100, dataState: "final", filters }, { accessToken: access.accessToken }) : null,
    log: (text) => console.error(text),
  };
  // Historique (hors message courant, déjà enregistré) pour l'IA : rôles conversationnels seulement.
  const turns: ChatMessage[] = (history ?? []).slice(1).reverse().flatMap((item): ChatMessage[] => item.sender_type === "admin" ? [{ role: "user" as const, content: String(item.message).slice(0, 1500) }] : item.sender_type === "agent" ? [{ role: "assistant" as const, content: String(item.message).slice(0, 1500) }] : []);
  const reply = await replyToMessage(row, client?.name ?? "Client", message, turns, deps);
  await createAgentMessage(recommendationId, reply.text, { source: reply.source, intent: reply.intent, opportunity_id: row.id, ...(reply.proposal ? { proposal: reply.proposal } : {}), ...(reply.degraded ? { degraded: true } : {}) });
  return reply;
}
