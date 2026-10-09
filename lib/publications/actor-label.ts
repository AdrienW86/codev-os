/** Human-readable labels only. The journal retains the original actor identifiers. */
export function publicationActorLabel(actorId: string | null | undefined, actorType?: string): string {
  if (actorType === "system") return "Système";
  if (actorType === "agent") return "Agent";
  if (actorId?.startsWith("user_")) return "Administrateur";
  return actorId ? "Auteur historique" : "Auteur non renseigné";
}
