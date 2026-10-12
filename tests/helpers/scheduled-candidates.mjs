// Miroir JS de public.publication_scheduled_delivery_candidates (la vraie requête est testée en base, P10_FULL_CHAIN).
export function candidates(args, t) {
  const rows = (t.publications ?? []).filter(p => p.status === "approved" && !p.archived_at && p.occurrence_id && p.current_revision_id
    && !(t.publication_deliveries ?? []).some(d => d.publication_id === p.id && d.revision_id === p.current_revision_id)).flatMap(p => {
    const at = (t.publication_channel_occurrences ?? []).find(o => o.id === p.occurrence_id)?.scheduled_for;
    if (!at || at < new Date(Date.parse(args.p_late_before) - 7 * 86400000).toISOString()) return [];
    const state = at < args.p_late_before ? "missed" : (t.unpublishable_photos ?? []).includes(p.id) ? "photo_unpublishable" : "ready";
    return [{ publication_id: p.id, revision_id: p.current_revision_id, scheduled_for: at, state }];
  }).filter(c => c.state === "ready" || !(t.admin_notifications ?? []).some(n => n.event_key === `publication-${c.state.replace("_", "-")}:${c.publication_id}:${c.revision_id}`));
  return rows.sort((a, b) => (a.state !== "ready") - (b.state !== "ready") || a.scheduled_for.localeCompare(b.scheduled_for)).slice(0, args.p_limit);
}
