// Résultats de la prospection e-mail par espace (fonction pure) : envois, réponses, oppositions, rebonds, plaintes.
// Taux calculés sur les premiers contacts envoyés ; une donnée absente vaut 0 (jamais estimée).

export type StatsMessage = { state: string; step?: number | null; sent_at: string | null; replied_at?: string | null; reply_kind?: string | null; provider_message_id?: string | null };
export type StatsEvent = { provider_message_id: string | null; event_type: string; detail: string | null };
export type ProspectingStats = {
  sent: number; firstContacts: number; followUps: number; queued: number; delivered: number;
  replies: number; stops: number; hardBounces: number; complaints: number;
  /** Pourcentages arrondis à une décimale, null tant qu'aucun premier contact n'est parti. */
  replyRate: number | null; bounceRate: number | null;
};

const pct = (part: number, total: number) => total > 0 ? Math.round((part / total) * 1000) / 10 : null;

export function prospectingStats(messages: readonly StatsMessage[], events: readonly StatsEvent[]): ProspectingStats {
  const sent = messages.filter((m) => m.state === "sent");
  const first = sent.filter((m) => (m.step ?? 1) === 1);
  const ids = new Set(sent.map((m) => m.provider_message_id).filter((id): id is string => Boolean(id)));
  const mine = events.filter((e) => e.provider_message_id && ids.has(e.provider_message_id));
  const uniqueBy = (type: string, keep: (e: StatsEvent) => boolean = () => true) => new Set(mine.filter((e) => e.event_type === type && keep(e)).map((e) => e.provider_message_id)).size;
  const hardBounces = uniqueBy("email.bounced", (e) => (e.detail ?? "").startsWith("Permanent"));
  // Une opposition ou une réponse compte une fois par entreprise (dernier message auquel elle a répondu).
  const replies = messages.filter((m) => m.replied_at && m.reply_kind === "reply").length;
  const stops = messages.filter((m) => m.replied_at && m.reply_kind === "stop").length;
  return {
    sent: sent.length, firstContacts: first.length, followUps: sent.length - first.length,
    queued: messages.filter((m) => m.state === "approved").length, delivered: uniqueBy("email.delivered"),
    replies, stops, hardBounces, complaints: uniqueBy("email.complained"),
    replyRate: pct(replies, first.length), bounceRate: pct(hardBounces, sent.length),
  };
}
