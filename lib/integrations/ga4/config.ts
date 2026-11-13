import "server-only";
import { credentialKeyring, oauthBaseUrl } from "@/lib/integrations/publications-oauth/config";

export const GA4_CALLBACK_PATH = "/api/integrations/google-analytics/callback";
type Env = Record<string, string | undefined>;
export type Ga4OAuthConfig = { clientId: string; clientSecret: string; redirectUri: string; credentials: "analytics" | "business_profile" };

const validPair = (id: string | undefined, secret: string | undefined) =>
  Boolean(id && secret && id.length >= 20 && id.length <= 300 && id.endsWith(".apps.googleusercontent.com") && secret.length >= 10 && secret.length <= 200 && /^[\x21-\x7e]+$/.test(secret));

export function ga4RedirectUri(env: Env = process.env) {
  const origin = oauthBaseUrl(env);
  return origin ? origin + GA4_CALLBACK_PATH : null;
}

export function ga4OAuthConfig(env: Env = process.env): Ga4OAuthConfig | null {
  const redirectUri = ga4RedirectUri(env);
  if (!redirectUri) return null;
  const dedicated = Boolean(env.GOOGLE_ANALYTICS_CLIENT_ID || env.GOOGLE_ANALYTICS_CLIENT_SECRET);
  const id = dedicated ? env.GOOGLE_ANALYTICS_CLIENT_ID : env.GOOGLE_BUSINESS_PROFILE_CLIENT_ID;
  const secret = dedicated ? env.GOOGLE_ANALYTICS_CLIENT_SECRET : env.GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET;
  if (!validPair(id, secret)) return null;
  return { clientId: id!, clientSecret: secret!, redirectUri, credentials: dedicated ? "analytics" : "business_profile" };
}
export const ga4Keyring = credentialKeyring;

export function missingGa4Configuration(env: Env = process.env) {
  const missing: string[] = [];
  if (!oauthBaseUrl(env)) missing.push("PUBLICATIONS_OAUTH_BASE_URL");
  if (!credentialKeyring(env)) missing.push("PUBLICATION_CREDENTIALS_KEY", "PUBLICATION_CREDENTIALS_KEY_ID");
  if (!ga4OAuthConfig(env)) missing.push("GOOGLE_ANALYTICS_CLIENT_ID / GOOGLE_ANALYTICS_CLIENT_SECRET (ou GOOGLE_BUSINESS_PROFILE_*)");
  return missing;
}
