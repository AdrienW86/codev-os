import "server-only";
// Registre éditorial permanent (lot 3) : lecture de tout ce qui a été publié ou proposé par canal, et réservations.
// Table des réservations absente (migration 20261211000000 non appliquée) : registre lu sans réservations, et une
// réservation est acceptée sans être enregistrée (comportement d'avant pour les agents).
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { proposedPublication } from "@/lib/publications/editorial-memory";
import { findDuplicate, topicFingerprint, RESERVATION_DAYS, type DuplicateMatch, type RegisterCandidate, type RegisterEntry } from "./model";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AGENT = /^[a-z][a-z0-9-]{1,40}$/;
const db = () => getSupabaseServerClient();
const missingTable = (error: unknown) => {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === "42P01" || e?.code === "PGRST205" || /could not find the table|does not exist/i.test(e?.message ?? "");
};
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * Registre du client : publications proposées, articles de blog et newsletters (hors annulés), plus les réservations
 * en cours. Erreur de lecture d'un canal : exception (l'appelant décide, jamais un registre partiel présenté comme complet).
 */
export async function readRegister(clientId: string, now = new Date()): Promise<RegisterEntry[]> {
  if (!UUID.test(clientId)) throw new Error("client invalid");
  const [publications, blog, newsletters, reservations] = await Promise.all([
    db().from("publications").select("id,subject,status,archived_at,created_at").eq("client_id", clientId).order("created_at", { ascending: false }).limit(300),
    db().from("blog_articles" as never).select("id,title,service,status,created_at").eq("client_id", clientId).order("created_at", { ascending: false }).limit(200),
    db().from("email_newsletters" as never).select("id,subject,status,created_at").eq("client_id", clientId).order("created_at", { ascending: false }).limit(100),
    db().from("editorial_reservations" as never).select("id,channel,topic,service,angle,reserved_at,expires_at").eq("client_id", clientId).eq("status", "reserved").limit(200),
  ]);
  const optional = (r: { error: unknown }) => r.error && !missingTable(r.error);
  if (publications.error || optional(blog) || optional(newsletters) || optional(reservations)) throw new Error("editorial register read");
  const entries: RegisterEntry[] = [];
  for (const p of (publications.data ?? []) as { id: string; subject: string | null; status: string | null; archived_at: string | null; created_at: string }[]) {
    const topic = text(p.subject);
    if (topic && proposedPublication(p)) entries.push({ channel: "social", topic, service: null, angle: null, status: "used", date: p.created_at, ref: `publication:${p.id}` });
  }
  for (const a of (blog.error ? [] : blog.data ?? []) as { id: string; title: string; service: string | null; status: string; created_at: string }[]) {
    if (a.status !== "cancelled" && text(a.title)) entries.push({ channel: "blog", topic: a.title.trim(), service: text(a.service), angle: null, status: "used", date: a.created_at, ref: `blog:${a.id}` });
  }
  for (const n of (newsletters.error ? [] : newsletters.data ?? []) as { id: string; subject: string; status: string; created_at: string }[]) {
    if (n.status !== "cancelled" && text(n.subject)) entries.push({ channel: "newsletter", topic: n.subject.trim(), service: null, angle: null, status: "used", date: n.created_at, ref: `newsletter:${n.id}` });
  }
  for (const r of (reservations.error ? [] : reservations.data ?? []) as { id: string; channel: RegisterEntry["channel"]; topic: string; service: string | null; angle: string | null; reserved_at: string; expires_at: string }[]) {
    if (new Date(r.expires_at) > now) entries.push({ channel: r.channel, topic: r.topic, service: r.service, angle: r.angle, status: "reserved", date: r.reserved_at, ref: `reservation:${r.id}` });
  }
  return entries;
}

export type Reservation = { ok: true; id: string | null } | { ok: false; duplicate: DuplicateMatch | null; message: string };

/**
 * Réserve un sujet avant l'écriture. Refus si le registre contient déjà ce sujet (ou un sujet ressemblant) ; refus aussi
 * si un autre agent vient de réserver la même empreinte (index unique). id null : réservations non installées.
 */
export async function reserveTopic(clientId: string, agent: string, candidate: RegisterCandidate, entries: readonly RegisterEntry[], now = new Date()): Promise<Reservation> {
  if (!UUID.test(clientId) || !AGENT.test(agent)) return { ok: false, duplicate: null, message: "Réservation invalide." };
  const duplicate = findDuplicate(candidate, entries, now);
  if (duplicate) return { ok: false, duplicate, message: "Sujet déjà traité ou réservé." };
  const fingerprint = topicFingerprint(candidate.topic);
  if (!fingerprint) return { ok: false, duplicate: null, message: "Sujet trop vague." };
  // Réservations expirées (agent interrompu) : libérées avant d'en poser une nouvelle.
  const expired = await db().from("editorial_reservations" as never).update({ status: "released", closed_at: now.toISOString() } as never)
    .eq("client_id", clientId).eq("status", "reserved").lt("expires_at", now.toISOString());
  if (expired.error) { if (missingTable(expired.error)) return { ok: true, id: null }; throw new Error("editorial reservation"); }
  const { data, error } = await db().from("editorial_reservations" as never).insert({
    client_id: clientId, channel: candidate.channel, topic: candidate.topic.replace(/\s+/g, " ").trim().slice(0, 300), fingerprint,
    service: candidate.service?.slice(0, 200) ?? null, angle: candidate.angle?.slice(0, 200) ?? null, reserved_by: agent,
    reserved_at: now.toISOString(), expires_at: new Date(now.getTime() + RESERVATION_DAYS * 86_400_000).toISOString(),
  } as never).select("id").single();
  if (error) {
    if (missingTable(error)) return { ok: true, id: null };
    if ((error as { code?: string }).code === "23505") return { ok: false, duplicate: null, message: "Sujet réservé à l’instant par un autre agent." };
    throw new Error("editorial reservation");
  }
  return { ok: true, id: (data as { id: string }).id };
}

/** Clôt une réservation : consommée par un contenu enregistré (ref « canal:uuid »), ou libérée si l'écriture a échoué. */
export async function closeReservation(id: string | null, outcome: { consumedBy: string } | "released", now = new Date()): Promise<void> {
  if (!id || !UUID.test(id)) return;
  const consumed = outcome !== "released" && /^[a-z]+:[0-9a-f-]{36}$/.test(outcome.consumedBy) ? outcome.consumedBy : null;
  await db().from("editorial_reservations" as never).update({ status: consumed ? "consumed" : "released", consumed_ref: consumed, closed_at: now.toISOString() } as never)
    .eq("id", id).eq("status", "reserved");
}
