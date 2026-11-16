import "server-only";
// Connexion Google Analytics 4 de CODE-V OS : un compte Google (celui de l'agence) autorisé une fois en OAuth 2.0,
// avec le seul scope analytics.readonly. Chaque client est ensuite associé à UNE propriété GA4 de ce compte.
//
// Même flux que Search Console (lib/integrations/search-console/connection.ts) : démarrage (Server Action, admin) →
// consentement Google → callback (route admin) → état consommé AVANT tout échange de code → code échangé côté serveur
// (PKCE S256) → scope vérifié → jeton de rafraîchissement chiffré (integration_credential_secrets, domaine
// « google-analytics ») → référence opaque sur la connexion globale (client_connections, provider google-analytics,
// client_id null) → découverte des propriétés. Jetons d'accès jamais stockés, gardés en mémoire jusqu'à une minute
// avant expiration. Journaux : étape et type d'erreur uniquement.
import { createHash, createHmac, randomBytes } from "node:crypto";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { providerJson, type FetchLike } from "@/lib/providers/api";
import { ProviderError } from "@/lib/providers/errors";
import { listAnalyticsProperties } from "@/lib/providers/google-analytics";
import { googleAnalyticsKeyring, googleAnalyticsOAuthConfig, googleAnalyticsRedirectUri, missingGoogleAnalyticsConfiguration, type GoogleAnalyticsOAuthConfig } from "@/lib/integrations/google-analytics/config";
import { createSearchConsoleVault, isSecretReference, supabaseSecretTable, type SearchConsoleVault } from "@/lib/integrations/search-console/vault";
import { GOOGLE_ANALYTICS_PROVIDER, GOOGLE_ANALYTICS_SCOPE, storedAnalyticsProperties, type DiscoveredAnalyticsProperty } from "@/lib/integrations/google-analytics/model";
import type { Json } from "@/lib/supabase/database.types";

type Env = Record<string, string | undefined>;
type Db = ReturnType<typeof getSupabaseServerClient>;
export type GoogleAnalyticsDeps = { db: Db; config: GoogleAnalyticsOAuthConfig | null; vault: SearchConsoleVault | null; pkceKey: Uint8Array | null; env: Env; fetchImpl?: FetchLike; now?: () => number; random?: () => string };

export function productionGoogleAnalyticsDeps(): GoogleAnalyticsDeps {
  const db = getSupabaseServerClient();
  const keyring = googleAnalyticsKeyring();
  return {
    db, env: process.env, config: googleAnalyticsOAuthConfig(),
    vault: keyring ? createSearchConsoleVault(supabaseSecretTable(db, GOOGLE_ANALYTICS_PROVIDER), keyring, undefined, GOOGLE_ANALYTICS_PROVIDER) : null,
    pkceKey: keyring ? createHmac("sha256", keyring.current.key).update("codev:google-analytics-oauth:pkce:v1").digest() : null,
  };
}

const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ALLOWED_SCOPES = new Set([GOOGLE_ANALYTICS_SCOPE, "https://www.googleapis.com/auth/analytics"]);
const STATE = /^[A-Za-z0-9_-]{43}$/;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const base64url = (value: Uint8Array) => Buffer.from(value).toString("base64url");
const log = (step: string, error?: unknown) => console.error("[google-analytics]", { step, kind: error instanceof ProviderError ? error.kind : error ? "internal" : "none" });
const pkceVerifier = (key: Uint8Array, state: string) => base64url(createHmac("sha256", key).update(`pkce:${state}`).digest());

// ——— Connexion globale ———

export type GoogleAnalyticsConnection = { id: string; status: string; reference: string | null; connectedAt: string | null; properties: DiscoveredAnalyticsProperty[]; discoveredAt: string | null; lastError: string | null; metadata: Record<string, unknown> };

export async function readGoogleAnalyticsConnection(db: Db = getSupabaseServerClient()): Promise<GoogleAnalyticsConnection | null> {
  const { data, error } = await db.from("client_connections").select("id,status,credential_reference,connected_at,metadata,last_error").eq("provider", GOOGLE_ANALYTICS_PROVIDER).is("client_id", null).maybeSingle();
  if (error) throw new Error("google analytics connection read");
  if (!data) return null;
  const metadata = data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata) ? data.metadata as Record<string, unknown> : {};
  return {
    id: data.id, status: data.status, reference: isSecretReference(data.credential_reference) ? data.credential_reference : null, connectedAt: data.connected_at,
    properties: storedAnalyticsProperties(metadata), discoveredAt: typeof metadata.discovered_at === "string" ? metadata.discovered_at : null, lastError: data.last_error ?? null, metadata,
  };
}

export type GoogleAnalyticsStatus = {
  ready: boolean; missing: string[]; redirectUri: string | null; credentials: GoogleAnalyticsOAuthConfig["credentials"] | null;
  connection: Omit<GoogleAnalyticsConnection, "reference" | "metadata"> | null;
};

/** État affichable (aucune valeur secrète : noms de variables et état de la connexion). */
export async function googleAnalyticsStatus(deps: GoogleAnalyticsDeps = productionGoogleAnalyticsDeps()): Promise<GoogleAnalyticsStatus> {
  const connection = await readGoogleAnalyticsConnection(deps.db);
  const visible = connection ? { id: connection.id, status: connection.status, connectedAt: connection.connectedAt, properties: connection.properties, discoveredAt: connection.discoveredAt, lastError: connection.lastError } : null;
  return { ready: Boolean(deps.config && deps.vault && deps.pkceKey), missing: missingGoogleAnalyticsConfiguration(deps.env), redirectUri: googleAnalyticsRedirectUri(deps.env), credentials: deps.config?.credentials ?? null, connection: visible };
}

// ——— Jetons ———

type TokenResponse = { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; scope?: unknown; token_type?: unknown };
const opaque = (value: unknown, max = 4096): value is string => typeof value === "string" && value.length >= 8 && value.length <= max && /^[\x21-\x7e]+$/.test(value);

/** Réponse du point de jeton validée : jeton porteur, durée explicite, scope Analytics en lecture, rien de plus. */
export function validateAnalyticsTokenResponse(body: TokenResponse, now: number) {
  const scopes = typeof body.scope === "string" ? body.scope.split(" ").filter(Boolean).slice(0, 20) : [];
  if (!opaque(body.access_token) || typeof body.token_type !== "string" || body.token_type.toLowerCase() !== "bearer" || typeof body.expires_in !== "number" || !Number.isFinite(body.expires_in) || body.expires_in <= 60) throw new ProviderError("google-analytics", "malformed");
  if (!scopes.includes(GOOGLE_ANALYTICS_SCOPE) || scopes.some((scope) => !ALLOWED_SCOPES.has(scope))) throw new ProviderError("google-analytics", "unauthorized", null, "scope_mismatch");
  return { accessToken: body.access_token, refreshToken: opaque(body.refresh_token) ? body.refresh_token : null, scopes, expiresAt: now + (body.expires_in - 60) * 1000 };
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();
const pendingRefresh = new Map<string, Promise<string>>();

/** Source de jetons d'accès pour les appels GA4. `null` : aucune connexion utilisable. */
export async function googleAnalyticsAccess(deps: GoogleAnalyticsDeps = productionGoogleAnalyticsDeps()): Promise<{ accessToken: () => Promise<string> } | null> {
  const connection = await readGoogleAnalyticsConnection(deps.db);
  if (!connection || connection.status !== "active" || !connection.reference || !deps.config || !deps.vault) return null;
  const reference = connection.reference, config = deps.config, vault = deps.vault, now = deps.now ?? Date.now;
  const refresh = async () => {
    const grant = await vault.read(reference).catch((error) => { log("vault_read", error); throw new ProviderError("google-analytics", "not_configured"); });
    let body: TokenResponse;
    try {
      body = await providerJson<TokenResponse>("google-analytics", TOKEN_URL, { method: "POST", fetchImpl: deps.fetchImpl, headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: grant.refreshToken, grant_type: "refresh_token" }) });
    } catch (error) {
      if (error instanceof ProviderError && error.code === "invalid_grant") {
        await deps.db.from("client_connections").update({ status: "revoked", last_error: "Accès révoqué ou expiré côté Google : reconnectez Google Analytics." }).eq("provider", GOOGLE_ANALYTICS_PROVIDER).is("client_id", null).then(() => undefined, () => undefined);
        throw new ProviderError("google-analytics", "unauthorized", error.status, "invalid_grant");
      }
      throw error;
    }
    const token = validateAnalyticsTokenResponse(body, now());
    tokenCache.set(reference, { token: token.accessToken, expiresAt: token.expiresAt });
    return token.accessToken;
  };
  return {
    accessToken: () => {
      const cached = tokenCache.get(reference);
      if (cached && cached.expiresAt > now()) return Promise.resolve(cached.token);
      let pending = pendingRefresh.get(reference);
      if (!pending) { pending = refresh().finally(() => pendingRefresh.delete(reference)); pendingRefresh.set(reference, pending); }
      return pending;
    },
  };
}

// ——— OAuth ———

export type AnalyticsOAuthOutcome = "success" | "partial" | "refused" | "expired" | "invalid" | "unavailable" | "scope";
export const analyticsOAuthMessages: Record<AnalyticsOAuthOutcome, string> = {
  success: "Google Analytics est connecté.",
  partial: "Google Analytics est connecté, mais les propriétés n’ont pas pu être récupérées. Utilisez « Actualiser les propriétés ».",
  refused: "Autorisation refusée : Google Analytics n’est pas connecté.",
  expired: "Lien d’autorisation expiré : relancez la connexion.",
  invalid: "Lien d’autorisation invalide ou déjà utilisé.",
  scope: "Autorisation incomplète : l’accès en lecture à Google Analytics n’a pas été accordé.",
  unavailable: "Connexion impossible pour le moment.",
};
export const isAnalyticsOAuthOutcome = (value: unknown): value is AnalyticsOAuthOutcome => typeof value === "string" && Object.hasOwn(analyticsOAuthMessages, value);
export const analyticsOAuthReturnPath = (outcome: AnalyticsOAuthOutcome) => `/settings?tab=connections&ga=${outcome}#google-analytics`;

/** Démarrage : état aléatoire à usage unique (seule son empreinte est stockée, 10 minutes), URL Google officielle. */
export async function startGoogleAnalyticsOAuth(userId: string, deps: GoogleAnalyticsDeps = productionGoogleAnalyticsDeps()): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  if (!deps.config || !deps.vault || !deps.pkceKey) return { ok: false, message: "Connexion indisponible : configuration OAuth incomplète côté serveur." };
  try {
    const state = deps.random ? deps.random() : base64url(randomBytes(32));
    if (!STATE.test(state)) throw new Error("state");
    const now = deps.now ?? Date.now;
    const { error } = await deps.db.from("integration_oauth_states").insert({ state_hash: hash(state), provider: GOOGLE_ANALYTICS_PROVIDER, actor_id: userId, expires_at: new Date(now() + 10 * 60_000).toISOString() });
    if (error) throw new Error("state");
    const challenge = base64url(createHash("sha256").update(pkceVerifier(deps.pkceKey, state)).digest());
    const params = new URLSearchParams({
      client_id: deps.config.clientId, redirect_uri: deps.config.redirectUri, response_type: "code", scope: GOOGLE_ANALYTICS_SCOPE,
      // Jeton propre à Google Analytics : aucun scope déjà accordé (Search Console, Business Profile, Drive) n'y est ajouté.
      access_type: "offline", prompt: "consent", include_granted_scopes: "false", state, code_challenge: challenge, code_challenge_method: "S256",
    });
    return { ok: true, url: `${AUTHORIZE}?${params}` };
  } catch (error) { log("start", error); return { ok: false, message: "Connexion impossible pour le moment." }; }
}

/** Callback : renvoie l'issue (chemin interne fixe), jamais une valeur Google. */
export async function completeGoogleAnalyticsOAuth(userId: string, query: URLSearchParams, deps: GoogleAnalyticsDeps = productionGoogleAnalyticsDeps()): Promise<{ outcome: AnalyticsOAuthOutcome; connectionId: string | null; properties: number }> {
  const fail = (outcome: AnalyticsOAuthOutcome) => ({ outcome, connectionId: null, properties: 0 });
  const state = query.get("state");
  if (!state || !STATE.test(state)) return fail("invalid");
  const now = deps.now ?? Date.now;
  const consumed = await deps.db.from("integration_oauth_states").update({ consumed_at: new Date(now()).toISOString() })
    .eq("state_hash", hash(state)).eq("provider", GOOGLE_ANALYTICS_PROVIDER).eq("actor_id", userId).is("consumed_at", null).select("expires_at");
  const row = !consumed.error && Array.isArray(consumed.data) && consumed.data.length === 1 ? consumed.data[0] as { expires_at: string } : null;
  if (!row) { log("state"); return fail("invalid"); }
  if (Date.parse(row.expires_at) <= now()) return fail("expired");
  const providerError = query.get("error");
  if (providerError) return fail(providerError === "access_denied" ? "refused" : "unavailable");
  const code = query.get("code");
  if (!code || code.length > 4096 || !/^[\x21-\x7e]+$/.test(code)) return fail("invalid");
  if (!deps.config || !deps.vault || !deps.pkceKey) return fail("unavailable");

  let token: ReturnType<typeof validateAnalyticsTokenResponse>;
  try {
    const body = await providerJson<TokenResponse>("google-analytics", TOKEN_URL, { method: "POST", fetchImpl: deps.fetchImpl, headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: deps.config.clientId, client_secret: deps.config.clientSecret, code, code_verifier: pkceVerifier(deps.pkceKey, state), redirect_uri: deps.config.redirectUri, grant_type: "authorization_code" }) });
    token = validateAnalyticsTokenResponse(body, now());
  } catch (error) {
    log("exchange", error);
    return fail(error instanceof ProviderError && error.code === "scope_mismatch" ? "scope" : error instanceof ProviderError && error.code === "invalid_grant" ? "expired" : "unavailable");
  }
  if (!token.refreshToken) { log("exchange_no_refresh"); return fail("unavailable"); }

  let reference: string;
  try { reference = await deps.vault.store({ refreshToken: token.refreshToken, scopes: token.scopes }); }
  catch (error) { log("vault_store", error); return fail("unavailable"); }

  const existing = await readGoogleAnalyticsConnection(deps.db).catch(() => undefined);
  if (existing === undefined) { await deps.vault.remove(reference).catch(() => log("vault_cleanup")); return fail("unavailable"); }
  const patch = { status: "active", credential_reference: reference, connected_at: new Date(now()).toISOString(), scopes: token.scopes, last_error: null };
  const written = existing
    ? await deps.db.from("client_connections").update(patch).eq("id", existing.id).is("client_id", null).select("id")
    : await deps.db.from("client_connections").insert({ client_id: null, scope: "global", provider: GOOGLE_ANALYTICS_PROVIDER, metadata: {}, ...patch }).select("id");
  const connectionId = !written.error && Array.isArray(written.data) && written.data[0] ? (written.data[0] as { id: string }).id : null;
  if (!connectionId) { log("register"); await deps.vault.remove(reference).catch(() => log("vault_cleanup")); return fail("unavailable"); }
  if (existing?.reference && existing.reference !== reference) {
    tokenCache.delete(existing.reference);
    await deps.vault.remove(existing.reference).catch(() => log("vault_cleanup"));
  }
  tokenCache.set(reference, { token: token.accessToken, expiresAt: token.expiresAt });
  try {
    const properties = await discoverProperties(deps, connectionId, existing?.metadata ?? {}, () => Promise.resolve(token.accessToken));
    return { outcome: "success", connectionId, properties: properties.length };
  } catch (error) { log("discovery", error); return { outcome: "partial", connectionId, properties: 0 }; }
}

async function discoverProperties(deps: GoogleAnalyticsDeps, connectionId: string, metadata: Record<string, unknown>, accessToken: () => Promise<string>) {
  const properties = await listAnalyticsProperties({ accessToken, fetchImpl: deps.fetchImpl });
  const now = deps.now ?? Date.now;
  const { error } = await deps.db.from("client_connections").update({ metadata: { ...metadata, properties, discovered_at: new Date(now()).toISOString() } as unknown as Json }).eq("id", connectionId).is("client_id", null);
  if (error) throw new Error("properties write");
  return properties;
}

export async function refreshGoogleAnalyticsProperties(deps: GoogleAnalyticsDeps = productionGoogleAnalyticsDeps()): Promise<{ ok: true; count: number } | { ok: false; message: string }> {
  const connection = await readGoogleAnalyticsConnection(deps.db);
  if (!connection || connection.status !== "active") return { ok: false, message: "Google Analytics n’est pas connecté." };
  const access = await googleAnalyticsAccess(deps);
  if (!access) return { ok: false, message: "Connexion indisponible : configuration OAuth incomplète côté serveur." };
  try {
    const properties = await discoverProperties(deps, connection.id, connection.metadata, access.accessToken);
    return { ok: true, count: properties.length };
  } catch (error) {
    log("discovery", error);
    return { ok: false, message: error instanceof ProviderError ? error.message : "Propriétés indisponibles pour le moment." };
  }
}

/** Déconnexion locale (jeton chiffré supprimé), sans révocation Google : le client OAuth peut être partagé. */
export async function disconnectGoogleAnalytics(deps: GoogleAnalyticsDeps = productionGoogleAnalyticsDeps()): Promise<{ ok: boolean; message: string }> {
  const connection = await readGoogleAnalyticsConnection(deps.db);
  if (!connection || connection.status === "disabled") return { ok: true, message: "Google Analytics était déjà déconnecté." };
  const { error } = await deps.db.from("client_connections").update({ status: "disabled", credential_reference: null, last_error: null }).eq("id", connection.id).is("client_id", null);
  if (error) throw new Error("google analytics disconnect");
  if (connection.reference) {
    tokenCache.delete(connection.reference);
    if (deps.vault) await deps.vault.remove(connection.reference).catch(() => log("vault_cleanup"));
  }
  return { ok: true, message: "Google Analytics est déconnecté. Les données déjà synchronisées sont conservées." };
}
