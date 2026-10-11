import "server-only";
// Configuration OAuth Search Console, lue côté serveur et validée à l'usage (fail closed). Aucune valeur n'est
// renvoyée à un composant, journalisée ni stockée ; seuls les NOMS des variables manquantes sont affichés.
//
// Identifiants : GOOGLE_SEARCH_CONSOLE_CLIENT_ID / _SECRET s'ils sont définis, sinon réutilisation du client OAuth Web
// déjà configuré pour Google Business Profile (même projet Google Cloud). Une configuration Search Console partielle
// n'est jamais complétée par l'autre : elle désactive la connexion.
// URL de base et clé de chiffrement : celles des connexions OAuth existantes (PUBLICATIONS_OAUTH_BASE_URL,
// PUBLICATION_CREDENTIALS_KEY / _KEY_ID), avec une séparation de domaine propre à Search Console.
import { credentialKeyring, oauthBaseUrl, type CredentialKeyring } from "@/lib/integrations/publications-oauth/config";

type Env = Record<string, string | undefined>;
export const SEARCH_CONSOLE_CALLBACK_PATH = "/api/integrations/search-console/callback";
export type SearchConsoleOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string; credentials: "search_console" | "business_profile" };

const opaque = (value: unknown, min: number, max: number): value is string => typeof value === "string" && value.length >= min && value.length <= max && /^[\x21-\x7e]+$/.test(value);
const validPair = (id: unknown, secret: unknown) => opaque(id, 20, 300) && id.endsWith(".apps.googleusercontent.com") && opaque(secret, 10, 200);

function clientCredentials(env: Env): { clientId: string; clientSecret: string; credentials: SearchConsoleOAuthConfig["credentials"] } | null {
  const ownId = env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID, ownSecret = env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET;
  if (ownId || ownSecret) return validPair(ownId, ownSecret) ? { clientId: ownId!, clientSecret: ownSecret!, credentials: "search_console" } : null;
  const sharedId = env.GOOGLE_BUSINESS_PROFILE_CLIENT_ID, sharedSecret = env.GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET;
  return validPair(sharedId, sharedSecret) ? { clientId: sharedId!, clientSecret: sharedSecret!, credentials: "business_profile" } : null;
}

export function searchConsoleRedirectUri(env: Env = process.env) {
  const base = oauthBaseUrl(env);
  return base ? base + SEARCH_CONSOLE_CALLBACK_PATH : null;
}

export function searchConsoleOAuthConfig(env: Env = process.env): SearchConsoleOAuthConfig | null {
  const redirectUri = searchConsoleRedirectUri(env);
  const credentials = clientCredentials(env);
  return redirectUri && credentials ? { ...credentials, redirectUri } : null;
}

export function searchConsoleKeyring(env: Env = process.env): CredentialKeyring | null {
  return credentialKeyring(env);
}

/** Noms des variables manquantes ou invalides (jamais leurs valeurs). */
export function missingSearchConsoleConfiguration(env: Env = process.env): string[] {
  const missing: string[] = [];
  if (!oauthBaseUrl(env)) missing.push("PUBLICATIONS_OAUTH_BASE_URL");
  if (!credentialKeyring(env)) missing.push("PUBLICATION_CREDENTIALS_KEY", "PUBLICATION_CREDENTIALS_KEY_ID");
  if (!clientCredentials(env)) missing.push("GOOGLE_SEARCH_CONSOLE_CLIENT_ID", "GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET");
  return missing;
}
