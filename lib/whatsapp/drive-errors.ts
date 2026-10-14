// Diagnostic de l'accès Drive d'import (WhatsApp) : codes d'erreur fermés, sans aucune donnée sensible.
// Seuls des identifiants techniques de Google figurant dans une liste blanche sont lus dans les réponses d'erreur ;
// les descriptions, tokens et corps bruts ne sont jamais conservés, journalisés ni affichés.

export const importVariables = ["GOOGLE_DRIVE_IMPORT_CLIENT_ID", "GOOGLE_DRIVE_IMPORT_CLIENT_SECRET", "GOOGLE_DRIVE_IMPORT_REFRESH_TOKEN"] as const;
export type ImportVariable = (typeof importVariables)[number];

export const driveErrorCodes = [
  "config_missing", "config_invalid",
  "oauth_invalid_grant", "oauth_invalid_client", "oauth_unauthorized_client", "oauth_rejected",
  "drive_scope_missing", "drive_scope_readonly", "drive_scope_too_broad",
  "drive_api_disabled", "drive_permission", "drive_rate_limited", "drive_storage_quota", "drive_not_found", "drive_rejected",
  "drive_folder", "drive_folder_create", "provider_unavailable", "provider_response",
  "client_not_found", "database_unavailable", "audit_unavailable", "unexpected",
] as const;
export type DriveErrorCode = (typeof driveErrorCodes)[number];

const oauthErrors: Record<string, DriveErrorCode> = {
  invalid_grant: "oauth_invalid_grant",
  invalid_client: "oauth_invalid_client",
  unauthorized_client: "oauth_unauthorized_client",
};
/** Erreur du point d'échange OAuth (oauth2.googleapis.com/token) : seul le champ `error` normalisé est lu. */
export function oauthErrorCode(status: number, body: unknown): DriveErrorCode {
  if (status === 429 || status >= 500) return "provider_unavailable";
  const error = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  if (typeof error === "string" && Object.hasOwn(oauthErrors, error)) return oauthErrors[error];
  if (status === 401) return "oauth_invalid_client";
  return "oauth_rejected";
}

const driveReasons: Record<string, DriveErrorCode> = {
  accessNotConfigured: "drive_api_disabled", SERVICE_DISABLED: "drive_api_disabled",
  insufficientPermissions: "drive_permission", ACCESS_TOKEN_SCOPE_INSUFFICIENT: "drive_scope_missing", forbidden: "drive_permission", appNotAuthorizedToFile: "drive_permission",
  rateLimitExceeded: "drive_rate_limited", userRateLimitExceeded: "drive_rate_limited", RATE_LIMIT_EXCEEDED: "drive_rate_limited",
  storageQuotaExceeded: "drive_storage_quota", notFound: "drive_not_found",
};
/** Erreur de l'API Drive v3 : seules les « reason » connues de `error.errors[]` et `error.details[]` sont lues. */
export function driveErrorCode(status: number, body: unknown): DriveErrorCode {
  const error = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  const reasons: unknown[] = [];
  if (error && typeof error === "object") {
    for (const key of ["errors", "details"] as const) {
      const list = (error as Record<string, unknown>)[key];
      if (Array.isArray(list)) for (const item of list.slice(0, 10)) if (item && typeof item === "object") reasons.push((item as { reason?: unknown }).reason);
    }
  }
  for (const reason of reasons) if (typeof reason === "string" && Object.hasOwn(driveReasons, reason)) return driveReasons[reason];
  if (status === 429) return "drive_rate_limited";
  if (status >= 500) return "provider_unavailable";
  if (status === 401 || status === 403) return "drive_permission";
  if (status === 404) return "drive_not_found";
  return "drive_rejected";
}

const configHint = "Vérifiez la variable dans Vercel (environnement Production), sans espace ni retour à la ligne, puis redéployez : une variable ajoutée après le dernier déploiement n’est pas visible.";
const messages: Record<DriveErrorCode, string> = {
  config_missing: `Configuration Drive d’import absente sur le serveur. ${configHint}`,
  config_invalid: `Configuration Drive d’import mal formée. ${configHint}`,
  oauth_invalid_grant: "Google refuse le refresh token d’import (invalid_grant) : il est révoqué, expiré (application OAuth en mode « Test » : 7 jours) ou a été émis pour un autre client OAuth. Générez-en un nouveau avec ce même client et la portée drive.file.",
  oauth_invalid_client: "Google ne reconnaît pas le client OAuth d’import (invalid_client) : vérifiez GOOGLE_DRIVE_IMPORT_CLIENT_ID et GOOGLE_DRIVE_IMPORT_CLIENT_SECRET (même client, secret actuel).",
  oauth_unauthorized_client: "Ce client OAuth n’est pas autorisé à utiliser ce refresh token (unauthorized_client) : le token a été émis par un autre client, ou le type de client ne permet pas l’accès hors ligne.",
  oauth_rejected: "Google a refusé l’échange du refresh token d’import. Régénérez le refresh token avec le client OAuth d’import et la portée drive.file.",
  drive_scope_missing: "Le refresh token d’import n’a pas la portée https://www.googleapis.com/auth/drive.file. Régénérez-le en cochant cette portée.",
  drive_scope_readonly: "Le jeton d’import est limité à la lecture de Google Drive. L’import WhatsApp exige un refresh token distinct avec la portée drive.file uniquement ; renseignez GOOGLE_DRIVE_IMPORT_CLIENT_ID, GOOGLE_DRIVE_IMPORT_CLIENT_SECRET et GOOGLE_DRIVE_IMPORT_REFRESH_TOKEN, sans modifier le connecteur Publications.",
  drive_scope_too_broad: "Le refresh token d’import donne un accès Drive plus large que drive.file (lecture seule ou Drive complet) : il est refusé par sécurité. Régénérez-le avec drive.file uniquement.",
  drive_api_disabled: "L’API Google Drive n’est pas activée dans le projet Google Cloud du client OAuth d’import. Activez « Google Drive API » puis réessayez après quelques minutes.",
  drive_permission: "Google Drive refuse l’opération pour ce compte : vérifiez que le compte autorisé peut créer des fichiers dans son Drive.",
  drive_rate_limited: "Google Drive limite temporairement les requêtes. Réessayez dans quelques minutes.",
  drive_storage_quota: "Le stockage Google Drive du compte autorisé est plein.",
  drive_not_found: "Élément Drive introuvable ou inaccessible pour l’application d’import.",
  drive_rejected: "Google Drive a refusé la requête de création du dossier.",
  drive_folder: "Dossier introuvable, dans la corbeille ou non autorisé à l’application d’import : créez-le depuis cet écran (portée drive.file).",
  drive_folder_create: "Google Drive n’a pas confirmé la création du dossier attendu. Vérifiez votre Drive avant de réessayer.",
  provider_unavailable: "Google ne répond pas pour le moment. Réessayez dans quelques minutes.",
  provider_response: "Réponse inattendue de Google. Réessayez ; si le problème persiste, consultez les journaux serveur (code provider_response).",
  client_not_found: "Client introuvable.",
  database_unavailable: "Base de données indisponible : réessayez.",
  audit_unavailable: "Journal d’audit indisponible : aucune action n’a été faite dans Drive. Réessayez.",
  unexpected: "Erreur inattendue côté serveur. Consultez les journaux Vercel (préfixe [whatsapp-drive]).",
};
export function isDriveErrorCode(value: unknown): value is DriveErrorCode {
  return typeof value === "string" && (driveErrorCodes as readonly string[]).includes(value);
}
/** Message affichable : le nom d'une variable peut être cité, jamais sa valeur. */
export function driveErrorMessage(code: string, variable?: ImportVariable | null) {
  const known: DriveErrorCode = isDriveErrorCode(code) ? code : "unexpected";
  const base = messages[known];
  return variable && (known === "config_missing" || known === "config_invalid") ? base.replace("Configuration Drive d’import", `Variable ${variable}`) : base;
}
// Codes d'échec de la file d'import WhatsApp (whatsapp_inbox.error_code) : libellés courts, sans aucune donnée.
const inboxLabels: Record<string, string> = {
  retry_exhausted: "Abandon après 5 tentatives",
  import_unavailable: "Import interrompu (erreur serveur)",
  scope_missing: "Client ou dossier Drive non associé",
  lease_lost: "Traitement repris par un autre passage",
  asset_unavailable: "Photothèque indisponible pendant l’import",
  inbox_unavailable: "File d’import indisponible",
  invalid_media: "Média illisible",
  media_mismatch: "Média différent de celui annoncé par Meta",
  media_too_large: "Média trop volumineux",
  media_host: "Adresse de téléchargement Meta inattendue",
  media_unavailable: "Média plus disponible chez Meta (conservé 7 jours)",
  media_integrity: "Média altéré pendant le téléchargement",
  invalid_video: "Vidéo non prise en charge",
  invalid_image: "Image non prise en charge",
  provider_permission: "Accès refusé par Meta (jeton WhatsApp)",
  drive_upload: "Dépôt dans Drive refusé",
  drive_upload_host: "Adresse de dépôt Drive inattendue",
  drive_file_missing: "Fichier introuvable dans Drive après dépôt",
  drive_file_conflict: "Conflit de fichier dans Drive",
};
/** Libellé français d'un code d'échec de la file d'import (jamais le code brut seul, jamais un message fournisseur). */
export function inboxErrorLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  if (Object.hasOwn(inboxLabels, code)) return inboxLabels[code];
  return isDriveErrorCode(code) ? driveErrorMessage(code) : "Erreur d’import non identifiée";
}
/** Journal serveur structuré : action, étape, code et statut HTTP uniquement. */
export function logDriveFailure(action: string, failure: { code: string; stage?: string; status?: number; variable?: string | null }) {
  console.error("[whatsapp-drive]", JSON.stringify({ action, code: failure.code, stage: failure.stage ?? null, status: failure.status ?? null, variable: failure.variable ?? null }));
}
