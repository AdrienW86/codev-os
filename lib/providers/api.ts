import "server-only";
// Appels JSON vers les API fournisseurs (hôtes connus uniquement), avec délai et erreurs normalisées.
import { ProviderError, errorDetailsFromBody, kindFromStatus } from "@/lib/providers/errors";

const ALLOWED_HOSTS = new Set([
  "oauth2.googleapis.com", "searchconsole.googleapis.com", "www.googleapis.com", "pagespeedonline.googleapis.com",
  "googleads.googleapis.com", "api.vercel.com", "api.github.com", "api.openai.com", "api.anthropic.com", "api.resend.com",
]);

export type FetchLike = typeof fetch;

export async function providerJson<T = unknown>(provider: string, url: string, init: RequestInit & { timeoutMs?: number; fetchImpl?: FetchLike } = {}): Promise<T> {
  let target: URL;
  try { target = new URL(url); } catch { throw new ProviderError(provider, "blocked"); }
  if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname)) throw new ProviderError(provider, "blocked");
  const { timeoutMs = 20_000, fetchImpl = fetch, ...rest } = init;
  let response: Response;
  try {
    response = await fetchImpl(target, { ...rest, cache: "no-store", redirect: "error", signal: rest.signal ?? AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const name = (error as { name?: string }).name;
    throw new ProviderError(provider, name === "TimeoutError" || name === "AbortError" ? "timeout" : "unavailable");
  }
  if (!response.ok) {
    // Seul le code d'erreur structuré est conservé (jamais le corps ni les en-têtes).
    const body = await response.text().catch(() => "");
    const details = errorDetailsFromBody(body.slice(0, 8_000));
    throw new ProviderError(provider, kindFromStatus(response.status), response.status, details.code, details);
  }
  const text = await response.text();
  if (text.length > 5_000_000) throw new ProviderError(provider, "malformed");
  try { return (text ? JSON.parse(text) : {}) as T; } catch { throw new ProviderError(provider, "malformed"); }
}

/** Jeton d'accès Google à partir d'un jeton de rafraîchissement (serveur uniquement). */
export async function googleAccessToken(provider: string, credentials: { clientId?: string; clientSecret?: string; refreshToken?: string }, fetchImpl?: FetchLike) {
  if (!credentials.clientId || !credentials.clientSecret || !credentials.refreshToken) throw new ProviderError(provider, "not_configured");
  const data = await providerJson<{ access_token?: unknown }>(provider, "https://oauth2.googleapis.com/token", {
    method: "POST", fetchImpl, headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: credentials.clientId, client_secret: credentials.clientSecret, refresh_token: credentials.refreshToken, grant_type: "refresh_token" }),
  });
  if (typeof data.access_token !== "string" || !data.access_token || /[\r\n]/.test(data.access_token)) throw new ProviderError(provider, "malformed");
  return data.access_token;
}
