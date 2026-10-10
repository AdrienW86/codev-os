// Erreurs fournisseurs normalisées : l'interface et les jobs réagissent au type, jamais au message brut.
export type ProviderErrorKind = "not_configured" | "unauthorized" | "rate_limited" | "timeout" | "unavailable" | "malformed" | "rejected" | "blocked" | "not_found";

const messages: Record<ProviderErrorKind, string> = {
  not_configured: "Connexion non configurée.",
  unauthorized: "Accès refusé ou jeton expiré : reconnectez le fournisseur.",
  rate_limited: "Quota du fournisseur atteint : nouvel essai plus tard.",
  timeout: "Le fournisseur n’a pas répondu à temps.",
  unavailable: "Fournisseur indisponible.",
  malformed: "Réponse du fournisseur inattendue.",
  rejected: "Requête refusée par le fournisseur (paramètre ou modèle non accepté).",
  blocked: "Adresse refusée par la politique de sécurité.",
  not_found: "Ressource introuvable chez le fournisseur.",
};

export class ProviderError extends Error {
  /**
   * Code d'erreur court renvoyé par le fournisseur (ex. « insufficient_quota », « invalid_api_key »,
   * « model_not_found », « unsupported_parameter »). Assaini : identifiant uniquement, jamais de message libre.
   */
  readonly code: string | null;
  /** Type d'erreur du fournisseur (ex. « invalid_request_error »), assaini. */
  readonly type: string | null;
  /** Permissions manquantes annoncées par le fournisseur (ex. « api.model.audio.request »), assainies. */
  readonly scopes: string[];
  constructor(readonly provider: string, readonly kind: ProviderErrorKind, readonly status: number | null = null, code: unknown = null, details: { type?: unknown; scopes?: unknown[] } = {}) {
    super(`${provider} : ${messages[kind]}`);
    this.code = sanitizeCode(code);
    this.type = sanitizeCode(details.type);
    this.scopes = (details.scopes ?? []).map(sanitizeCode).filter((scope): scope is string => Boolean(scope)).slice(0, 5);
  }
  /** Une nouvelle tentative a-t-elle du sens ? */
  get retryable() { return this.kind === "rate_limited" || this.kind === "timeout" || this.kind === "unavailable"; }
}

export function kindFromStatus(status: number): ProviderErrorKind {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unavailable";
  // 400 / 422… : la requête elle-même est refusée (paramètre, modèle) — distinct d'une réponse illisible.
  return "rejected";
}

/** Identifiant d'erreur fournisseur sûr à journaliser (lettres, chiffres, _ . -), sinon null. */
export function sanitizeCode(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : null;
}

export type ProviderErrorDetails = { code: string | null; type: string | null; scopes: string[] };

/**
 * Détails structurés d'une réponse d'erreur (formats OpenAI / Anthropic / Google).
 * OpenAI renvoie code = null pour un refus de permission ; la portée manquante n'apparaît que dans le
 * message (« Missing scopes: api.model.audio.request ») : seuls ces identifiants en sont extraits,
 * jamais le texte libre.
 */
export function errorDetailsFromBody(text: string): ProviderErrorDetails {
  try {
    const body = JSON.parse(text) as { error?: { code?: unknown; type?: unknown; status?: unknown; message?: unknown } | string };
    if (typeof body?.error === "string") return { code: sanitizeCode(body.error), type: null, scopes: [] };
    const message = typeof body?.error?.message === "string" ? body.error.message : "";
    const scopes = (/missing scopes?:\s*([a-z0-9_.,\s-]+)/i.exec(message)?.[1] ?? "").split(/[\s,]+/).map((scope) => scope.replace(/\.$/, "")).map(sanitizeCode).filter((scope): scope is string => Boolean(scope && scope.includes(".")));
    const type = sanitizeCode(body?.error?.type);
    const code = sanitizeCode(body?.error?.code) ?? (scopes.length ? "missing_scope" : null) ?? type ?? sanitizeCode(body?.error?.status);
    return { code, type, scopes };
  } catch { return { code: null, type: null, scopes: [] }; }
}

/** Code d'erreur seul (compatibilité). */
export function errorCodeFromBody(text: string): string | null {
  return errorDetailsFromBody(text).code;
}
