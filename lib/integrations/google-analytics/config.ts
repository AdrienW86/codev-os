import "server-only";
// Configuration OAuth Google Analytics 4, lue côté serveur et validée à l'usage (fail closed). Aucune valeur n'est
// renvoyée à un composant, journalisée ni stockée ; seuls les NOMS des variables manquantes sont affichés.
//
// Identifiants : GOOGLE_ANALYTICS_CLIENT_ID / _SECRET s'ils sont définis ; sinon le client OAuth de Search Console
// (GOOGLE_SEARCH_CONSOLE_CLIENT_ID / _SECRET), sinon celui de Google Business Profile (même projet Google Cloud).
// Une paire partielle n'est jamais complétée par une autre : elle désactive la connexion.
// URL de base et clé de chiffrement : celles des connexions OAuth existantes (PUBLICATIONS_OAUTH_BASE_URL,
// PUBLICATION_CREDENTIALS_KEY / _KEY_ID), avec un domaine de chiffrement propre à Google Analytics.
import { credentialKeyring, oauthBaseUrl } from "@/lib/integrations/publications-oauth/config";

type Env = Record<string, string | undefined>;
export const GOOGLE_ANALYTICS_CALLBACK_PATH = "/api/integrations/google-analytics/callback";
export type GoogleAnalyticsCredentials = "google_analytics" | "search_console" | "business_profile";
export type GoogleAnalyticsOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string; credentials: GoogleAnalyticsCredentials };

const opaque = (value: unknown, min: number, max: number): value is string => typeof value === "string" && value.length >= min && value.length <= max && /^[\x21-\x7e]+$/.test(value);
const validPair = (id: unknown, secret: unknown) => opaque(id, 20, 300) && id.endsWith(".apps.googleusercontent.com") && opaque(secret, 10, 200);

function clientCredentials(env: Env): { clientId: string; clientSecret: string; credentials: GoogleAnalyticsCredentials } | null {
  const pairs: [string | undefined, string | undefined, GoogleAnalyticsCredentials][] = [
    [env.GOOGLE_ANALYTICS_CLIENT_ID, env.GOOGLE_ANALYTICS_CLIENT_SECRET, "google_analytics"],
    [env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID, env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET, "search_console"],
    [env.GOOGLE_BUSINESS_PROFILE_CLIENT_ID, env.GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET, "business_profile"],
  ];
  for (const [id, secret, credentials] of pairs) {
    // Première paire commencée : elle seule décide (jamais de mélange entre deux clients OAuth).
    if (id || secret) return validPair(id, secret) ? { clientId: id!, clientSecret: secret!, credentials } : null;
  }
  return null;
}

export function googleAnalyticsRedirectUri(env: Env = process.env) {
  const base = oauthBaseUrl(env);
  return base ? base + GOOGLE_ANALYTICS_CALLBACK_PATH : null;
}

export function googleAnalyticsOAuthConfig(env: Env = process.env): GoogleAnalyticsOAuthConfig | null {
  const redirectUri = googleAnalyticsRedirectUri(env);
  const credentials = clientCredentials(env);
  return redirectUri && credentials ? { ...credentials, redirectUri } : null;
}

export const googleAnalyticsKeyring = (env: Env = process.env) => credentialKeyring(env);

/** Noms des variables manquantes ou invalides (jamais leurs valeurs). */
export function missingGoogleAnalyticsConfiguration(env: Env = process.env): string[] {
  const missing: string[] = [];
  if (!oauthBaseUrl(env)) missing.push("PUBLICATIONS_OAUTH_BASE_URL");
  if (!credentialKeyring(env)) missing.push("PUBLICATION_CREDENTIALS_KEY", "PUBLICATION_CREDENTIALS_KEY_ID");
  if (!clientCredentials(env)) missing.push("GOOGLE_ANALYTICS_CLIENT_ID", "GOOGLE_ANALYTICS_CLIENT_SECRET");
  return missing;
}
