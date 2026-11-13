import "server-only";
// Mémoire client partagée (lot 1) : lecture, synchronisation depuis la fiche client, saisie et validation.
// Table absente (migration 20261209000000 non appliquée) : les agents gardent leur contexte d'avant, rien ne casse.
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { todayInParis } from "@/lib/dashboard/home";
import {
  clientBrief, factsFromRecord, factFingerprint, parseFactInput, recordSyncPlan,
  FACT_KINDS, FACT_SOURCES, type ClientBrief, type ClientFact, type FactKind, type FactSource, type FactStatus,
} from "./model";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADMIN = /^user_[a-zA-Z0-9_-]{1,200}$/;
const db = () => getSupabaseServerClient();
const table = () => db().from("client_facts" as never);
const missingTable = (error: unknown) => {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === "42P01" || e?.code === "PGRST205" || /could not find the table|does not exist/i.test(e?.message ?? "");
};
export const MEMORY_NOT_INSTALLED = "Mémoire client non installée : appliquez la migration 20261209000000_client_memory.";

type Row = { id: string; kind: string; statement: string; source: string; source_ref: string | null; status: string; valid_until: string | null; confirmed_by: string | null; created_at: string };
const toFact = (r: Row): ClientFact | null => {
  const kind = FACT_KINDS.find((k) => k === r.kind), source = FACT_SOURCES.find((s) => s === r.source);
  if (!kind || !source || !["proposed", "confirmed", "rejected", "archived"].includes(r.status)) return null;
  return { id: r.id, kind, statement: r.statement, source, sourceRef: r.source_ref, status: r.status as FactStatus, validUntil: r.valid_until, confirmedBy: r.confirmed_by, createdAt: r.created_at };
};

/** Faits du client, tous statuts. null : mémoire non installée. */
export async function listClientFacts(clientId: string): Promise<ClientFact[] | null> {
  if (!UUID.test(clientId)) throw new Error("client invalid");
  const { data, error } = await table().select("id,kind,statement,source,source_ref,status,valid_until,confirmed_by,created_at").eq("client_id", clientId).order("created_at", { ascending: true }).limit(1000);
  if (error) { if (missingTable(error)) return null; throw new Error("memory read"); }
  return ((data ?? []) as Row[]).map(toFact).filter((f): f is ClientFact => f !== null);
}

const list = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()) : [];
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Recopie dans la mémoire les faits déjà saisis dans la fiche client et les réglages des agents (sans reformulation). */
export async function syncRecordFacts(clientId: string, existing: ClientFact[]): Promise<ClientFact[]> {
  const [client, profile, settings, projects] = await Promise.all([
    db().from("clients").select("name,activity,geographic_area").eq("id", clientId).maybeSingle(),
    db().from("client_media_profiles").select("services,activity_summary,communication_guidelines").eq("client_id", clientId).maybeSingle(),
    db().from("publication_client_settings").select("editorial_brief").eq("client_id", clientId).maybeSingle(),
    db().from("publication_agent_projects").select("verified_services,editorial_rules").eq("client_id", clientId),
  ]);
  // Lecture partielle : pas de synchronisation (on n'archive jamais un fait sur une lecture incomplète).
  if (client.error || !client.data || profile.error || settings.error || projects.error) return existing;
  const c = client.data as { name: string; activity: string | null; geographic_area: string | null };
  const p = (profile.data ?? {}) as Record<string, unknown>, st = (settings.data ?? {}) as Record<string, unknown>;
  const rows = (projects.data ?? []) as { verified_services: unknown; editorial_rules: string | null }[];
  const derived = factsFromRecord({
    name: c.name, activity: str(c.activity), zone: str(c.geographic_area),
    services: [...new Set([...rows.flatMap((r) => list(r.verified_services)), ...list(p.services)])],
    activitySummary: str(p.activity_summary), communicationGuidelines: str(p.communication_guidelines),
    editorialBrief: str(st.editorial_brief), editorialRules: rows.map((r) => str(r.editorial_rules)).filter((r): r is string => r !== null),
  });
  const plan = recordSyncPlan(derived, existing);
  if (!plan.create.length && !plan.archive.length && !plan.restore.length) return existing;
  const now = new Date().toISOString();
  if (plan.create.length) {
    const { error } = await table().upsert(plan.create.map((f) => ({
      client_id: clientId, kind: f.kind, statement: f.statement, fingerprint: factFingerprint(f.statement), source: "client_record", source_ref: f.sourceRef,
      status: "confirmed", confirmed_by: "system:client_record", confirmed_at: now, created_by: "system:client_record",
    })) as never, { onConflict: "client_id,kind,fingerprint", ignoreDuplicates: true });
    if (error) throw new Error("memory sync");
  }
  if (plan.archive.length) {
    const { error } = await table().update({ status: "archived", updated_at: now } as never).in("id", plan.archive).eq("source", "client_record");
    if (error) throw new Error("memory sync");
  }
  if (plan.restore.length) {
    const { error } = await table().update({ status: "confirmed", confirmed_by: "system:client_record", confirmed_at: now, updated_at: now } as never).in("id", plan.restore).eq("source", "client_record");
    if (error) throw new Error("memory sync");
  }
  return (await listClientFacts(clientId)) ?? existing;
}

/**
 * Brief d'un agent pour un client : faits confirmés de ses catégories, après synchronisation de la fiche client.
 * null : mémoire non installée ou illisible (l'agent garde son contexte d'avant, sans faits supplémentaires).
 */
export async function clientMemoryFor(clientId: string, agent: string): Promise<ClientBrief | null> {
  try {
    const facts = await listClientFacts(clientId);
    if (!facts) return null;
    return clientBrief(await syncRecordFacts(clientId, facts), agent, todayInParis());
  } catch {
    console.error("[client-memory] Mémoire client illisible.");
    return null;
  }
}

/** Écran Mémoire client : faits à jour de la fiche client. null : mémoire non installée. */
export async function clientMemoryView(clientId: string): Promise<ClientFact[] | null> {
  const facts = await listClientFacts(clientId);
  return facts ? syncRecordFacts(clientId, facts) : null;
}

/** Fait saisi par l'administrateur : confirmé immédiatement (c'est sa propre déclaration). */
export async function addClientFact(userId: string, clientId: string, input: { kind: unknown; statement: unknown; validUntil?: unknown }) {
  if (!ADMIN.test(userId) || !UUID.test(clientId)) return { ok: false, message: "Requête invalide." };
  const parsed = parseFactInput(input, todayInParis());
  if (!parsed.ok) return parsed;
  const now = new Date().toISOString();
  const { error } = await table().upsert({
    client_id: clientId, kind: parsed.kind, statement: parsed.statement, fingerprint: factFingerprint(parsed.statement), source: "admin", source_ref: null,
    status: "confirmed", confirmed_by: userId, confirmed_at: now, valid_until: parsed.validUntil, created_by: userId, updated_at: now,
  } as never, { onConflict: "client_id,kind,fingerprint" });
  if (error) return { ok: false, message: missingTable(error) ? MEMORY_NOT_INSTALLED : "Fait non enregistré." };
  return { ok: true, message: "Fait enregistré et confirmé." };
}

/**
 * Proposition d'un fait (agent, message du client, site) : jamais confirmée sans un administrateur.
 * Un fait déjà connu (même catégorie, même empreinte) n'est pas recréé ni rétrogradé.
 */
export async function proposeClientFacts(clientId: string, source: Exclude<FactSource, "client_record" | "admin">, createdBy: string, facts: readonly { kind: FactKind; statement: string; sourceRef?: string | null }[]) {
  if (!UUID.test(clientId) || !/^(system:[a-z_]{1,40}|agent:[a-z][a-z-]{1,30})$/.test(createdBy)) throw new Error("memory propose");
  const rows = facts.map((f) => ({ ...f, statement: f.statement.replace(/\s+/g, " ").trim().slice(0, 600) }))
    .filter((f) => FACT_KINDS.includes(f.kind) && f.statement.length >= 2 && factFingerprint(f.statement))
    .map((f) => ({ client_id: clientId, kind: f.kind, statement: f.statement, fingerprint: factFingerprint(f.statement), source, source_ref: f.sourceRef?.slice(0, 300) ?? null, status: "proposed", created_by: createdBy }));
  if (!rows.length) return 0;
  const { error } = await table().upsert(rows as never, { onConflict: "client_id,kind,fingerprint", ignoreDuplicates: true });
  if (error) { if (missingTable(error)) return 0; throw new Error("memory propose"); }
  return rows.length;
}

/** Décision de l'administrateur sur un fait : confirmer, rejeter ou archiver. */
export async function reviewClientFact(userId: string, clientId: string, factId: string, decision: unknown) {
  if (!ADMIN.test(userId) || !UUID.test(clientId) || !UUID.test(factId)) return { ok: false, message: "Requête invalide." };
  const now = new Date().toISOString();
  const patch = decision === "confirm" ? { status: "confirmed", confirmed_by: userId, confirmed_at: now, updated_at: now }
    : decision === "reject" ? { status: "rejected", updated_at: now }
    : decision === "archive" ? { status: "archived", updated_at: now } : null;
  if (!patch) return { ok: false, message: "Décision inconnue." };
  const { data, error } = await table().update(patch as never).eq("id", factId).eq("client_id", clientId).select("id");
  if (error) return { ok: false, message: missingTable(error) ? MEMORY_NOT_INSTALLED : "Décision non enregistrée." };
  if (!(data as unknown[] | null)?.length) return { ok: false, message: "Fait introuvable." };
  return { ok: true, message: decision === "confirm" ? "Fait confirmé : les agents peuvent l’utiliser." : decision === "reject" ? "Fait rejeté." : "Fait archivé." };
}
