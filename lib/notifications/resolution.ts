// Alerte de diffusion devenue sans objet : la diffusion « incertaine » ou « en échec » a été republiée ou
// confirmée publiée depuis (réconciliation). Fonction pure, testable.
const deliveryKey = /^publication-delivery:([0-9a-f-]{36}):(failed|uncertain|blocked)$/i;

export function deliveryIdOf(eventKey: string | null | undefined) {
  const match = eventKey ? deliveryKey.exec(eventKey) : null;
  return match ? match[1].toLowerCase() : null;
}

/** Identifiants des notifications dont la diffusion est aujourd'hui publiée. */
export function resolvedDeliveryNotifications(events: readonly { id: string; event_key: string | null }[], deliveries: readonly { id: string; status: string }[]) {
  const published = new Set(deliveries.filter((row) => row.status === "published").map((row) => row.id.toLowerCase()));
  return new Set(events.filter((event) => { const id = deliveryIdOf(event.event_key); return id !== null && published.has(id); }).map((event) => event.id));
}
