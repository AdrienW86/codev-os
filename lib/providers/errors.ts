// Erreurs fournisseurs normalisées : l'interface et les jobs réagissent au type, jamais au message brut.
export type ProviderErrorKind = "not_configured" | "unauthorized" | "rate_limited" | "timeout" | "unavailable" | "malformed" | "blocked" | "not_found";

const messages: Record<ProviderErrorKind, string> = {
  not_configured: "Connexion non configurée.",
  unauthorized: "Accès refusé ou jeton expiré : reconnectez le fournisseur.",
  rate_limited: "Quota du fournisseur atteint : nouvel essai plus tard.",
  timeout: "Le fournisseur n’a pas répondu à temps.",
  unavailable: "Fournisseur indisponible.",
  malformed: "Réponse du fournisseur inattendue.",
  blocked: "Adresse refusée par la politique de sécurité.",
  not_found: "Ressource introuvable chez le fournisseur.",
};

export class ProviderError extends Error {
  constructor(readonly provider: string, readonly kind: ProviderErrorKind, readonly status: number | null = null) {
    super(`${provider} : ${messages[kind]}`);
  }
  /** Une nouvelle tentative a-t-elle du sens ? */
  get retryable() { return this.kind === "rate_limited" || this.kind === "timeout" || this.kind === "unavailable"; }
}

export function kindFromStatus(status: number): ProviderErrorKind {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unavailable";
  return "malformed";
}
