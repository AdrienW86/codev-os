// Double en mémoire de la RPC audited_mutation (supabase/migrations/20261118000000_audited_mutations.sql) :
// même contrat que lib/core/audited-mutation.ts — mutation + entrée de journal ensemble, ou rien.
// rows : { table: [...] } ; audits : tableau qui reçoit les entrées de journal ; options.fail(m) : code d'erreur à lever.
const copy = (value) => value === null || value === undefined ? null : JSON.parse(JSON.stringify(value));
const pick = (row, columns) => !row ? null : !columns ? copy(row) : Object.fromEntries(Object.entries(copy(row)).filter(([key]) => columns.includes(key)));
export const plainColumns = (select) => select.split(",").map((s) => s.trim()).filter((c) => /^[a-z_][a-z0-9_]*$/.test(c));

export function fakeAuditedMutationModule(rows, audits, options = {}) {
  let sequence = 0;
  async function auditedMutation(m) {
    options.onCall?.(m);
    const code = options.fail?.(m);
    if (code) throw Object.assign(new Error("Écriture auditée refusée."), { code: code === true ? "XX000" : code });
    const table = rows[m.table] ?? (rows[m.table] = []);
    let before = null, after = null;
    if (m.operation === "insert") {
      after = { id: options.newId?.(m) ?? `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`, created_at: "2026-10-28T00:00:00Z", updated_at: "2026-10-28T00:00:00Z", ...copy(m.values) };
      table.push(after);
    } else {
      const index = table.findIndex((row) => row.id === m.id);
      if (index < 0) return null;
      before = copy(table[index]);
      if (m.expected && Object.entries(m.expected).some(([key, value]) => (table[index][key] ?? null) !== (value ?? null))) return null;
      if (m.operation === "update") { Object.assign(table[index], copy(m.values)); after = copy(table[index]); }
      else table.splice(index, 1);
    }
    audits.push({ action: m.audit.action, actor_type: m.audit.actor_type, actor_id: m.audit.actor_type === "admin" ? m.audit.actor_id : null, resource_type: m.audit.resource_type,
      resource_id: m.audit.resource_id ?? (after ?? before)?.id ?? null, before_data: pick(before, m.auditColumns), after_data: pick(after, m.auditColumns), metadata: copy(m.audit.metadata ?? {}) });
    return pick(m.operation === "delete" ? before : after, m.columns);
  }
  return { auditedMutation, plainColumns };
}
