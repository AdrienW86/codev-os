import type { PublicationReview, PublicationEvent, PublicationVariant } from "./types";

// Before the revision-scoped RPC, a single manual event produced one row per
// variant. Reconstruct that recorded business decision only when the complete
// transaction is proven. Independent variant decisions remain independent.
export function reviewDecisions(reviews: PublicationReview[], events: PublicationEvent[], variants: PublicationVariant[]): PublicationReview[] {
  const legacy = events.flatMap(event => {
    const m = event.metadata;
    if (event.action !== "publication.reviewed" || !m || typeof m !== "object" || Array.isArray(m)
      || typeof m.revision_id !== "string" || m.variant_id || m.review_id) return [];
    const rows = reviews.filter(r => r.variant_id !== null && r.publication_id === event.resource_id
      && r.revision_id === m.revision_id && r.client_id === event.client_id && r.actor_id === event.actor_id
      && r.decision === m.decision && r.created_at === event.created_at);
    const channels = variants.filter(v => v.revision_id === m.revision_id);
    if (!rows.length || rows.length !== channels.length
      || channels.some(v => rows.filter(r => r.variant_id === v.id).length !== 1)
      || rows.some(r => r.reason !== rows[0].reason)
      || events.filter(e => e.action === event.action && e.resource_id === event.resource_id
        && e.created_at === event.created_at && e.actor_id === event.actor_id).length !== 1) return [];
    return [{ rows, decision: { ...rows[0], id: event.id, variant_id: null } }];
  });
  return [...reviews.filter(r => !legacy.some(group => group.rows.some(row => row.id === r.id))),
    ...legacy.map(group => group.decision)];
}
