// Qui agit : l'administrateur (session Clerk vérifiée), le planificateur (cron authentifié)
// ou l'assistant (au nom de l'administrateur). Les services métier reçoivent toujours un acteur
// explicite ; l'autorisation est faite au point d'entrée (Server Action, route, cron).
export type Actor =
  | { kind: "admin"; userId: string }
  | { kind: "assistant"; userId: string }
  | { kind: "system"; worker: string };

export function actorAudit(actor: Actor): { actor_type: string; actor_id: string | null } {
  if (actor.kind === "system") return { actor_type: "system", actor_id: actor.worker.slice(0, 120) };
  return { actor_type: actor.kind === "assistant" ? "assistant" : "admin", actor_id: actor.userId };
}

export function actorLabel(actor: Actor) {
  return actor.kind === "system" ? `system:${actor.worker}` : `${actor.kind}:${actor.userId}`;
}
