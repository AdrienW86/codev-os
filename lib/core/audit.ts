import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { actorAudit, type Actor } from "@/lib/core/actor";
import type { Json } from "@/lib/supabase/database.types";

const SENSITIVE_KEY = /(token|secret|password|authorization|api[_-]?key|credential|cookie)/i;

/** Retire récursivement toute clé sensible avant journalisation (défense en profondeur). */
export function redact(value: unknown, depth = 0): Json {
  if (depth > 6) return "[…]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 80).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? "[redacted]" : redact(item, depth + 1)]));
  }
  if (typeof value === "string") return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  return null;
}

/**
 * Journal d'audit pour les services métier (acteur déjà autorisé par l'appelant).
 * Append-only côté base. Les données sont expurgées de tout secret.
 */
export async function writeAudit(actor: Actor, entry: { action: string; resource_type: string; resource_id: string | null; before?: unknown; after?: unknown; metadata?: Record<string, unknown> }) {
  const { error } = await getSupabaseServerClient().from("audit_logs").insert({
    ...actorAudit(actor),
    action: entry.action,
    resource_type: entry.resource_type,
    resource_id: entry.resource_id,
    before_data: entry.before === undefined ? null : redact(entry.before),
    after_data: entry.after === undefined ? null : redact(entry.after),
    metadata: redact(entry.metadata ?? {}),
  });
  if (error) {
    console.error("[audit] Échec de l’écriture du journal.");
    throw new Error("Journalisation indisponible.");
  }
}
