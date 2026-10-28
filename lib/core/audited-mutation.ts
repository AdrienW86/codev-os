import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

// Audit technique P1-03 : mutation et journal d'audit dans UNE transaction PostgreSQL (RPC audited_mutation).
// Les deux sont validés ensemble ou aucun : plus de mutation commise sans trace ni de nouvel essai ambigu.
// Les appelants vérifient l'administrateur (requireAdmin) avant tout appel ; l'acteur vient toujours du serveur.
export type AuditedTable = "clients" | "projects" | "tasks" | "actions";
export type AuditEntry = { action: string; resource_type: string; resource_id?: string; metadata?: Record<string, unknown> }
  & ({ actor_type: "admin"; actor_id: string } | { actor_type: "system"; actor_id?: null });
export type AuditedMutation = {
  table: AuditedTable;
  operation: "insert" | "update" | "delete";
  id?: string;
  values?: Record<string, unknown>;
  /** Conditions d'égalité à respecter au moment d'écrire (ex. statut attendu) ; sinon rien n'est écrit. */
  expected?: Record<string, unknown>;
  /** Colonnes renvoyées (toutes si absent). */
  columns?: readonly string[];
  /** Colonnes conservées dans before_data/after_data du journal (toutes si absent). */
  auditColumns?: readonly string[];
  audit: AuditEntry;
};
const list = (value: string) => value.split(",").map((s) => s.trim()).filter(Boolean);
/** Colonnes simples d'une liste de sélection PostgREST (sans jointures). */
export const plainColumns = (select: string) => list(select).filter((c) => /^[a-z_][a-z0-9_]*$/.test(c));

/** Ligne écrite (ou supprimée), ou null si la ligne n'existe pas / la condition attendue n'est plus vraie. Lève en cas d'échec. */
export async function auditedMutation<T = Record<string, unknown>>(m: AuditedMutation): Promise<T | null> {
  const { data, error } = await getSupabaseServerClient().rpc("audited_mutation", {
    p_table: m.table, p_operation: m.operation, p_id: m.id ?? null, p_values: (m.values ?? null) as Json | null, p_expected: (m.expected ?? null) as Json | null,
    p_columns: m.columns ? [...m.columns] : null,
    p_audit: { action: m.audit.action, resource_type: m.audit.resource_type, resource_id: m.audit.resource_id ?? null, actor_type: m.audit.actor_type,
      actor_id: m.audit.actor_type === "admin" ? m.audit.actor_id : null, metadata: (m.audit.metadata ?? {}) as Json },
    p_audit_columns: m.auditColumns ? [...m.auditColumns] : null,
  });
  if (error) throw Object.assign(new Error("Écriture auditée refusée."), { code: (error as { code?: string }).code });
  return (data ?? null) as T | null;
}
