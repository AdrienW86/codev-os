import "server-only";
// Connexion Google Search Console de CODE-V OS : un compte Google (celui de l'agence) autorisé une fois en OAuth 2.0,
// avec le seul scope webmasters.readonly. Chaque client est ensuite associé à UNE propriété de ce compte.
//
// Flux : démarrage (Server Action, admin) → consentement Google → callback (route derrière le proxy Clerk admin) →
// état consommé AVANT tout échange de code → code échangé côté serveur (PKCE S256) → scope vérifié → jeton de
// rafraîchissement chiffré dans integration_credential_secrets → référence opaque sur la connexion globale
// (client_connections, provider search-console, client_id null) → découverte des propriétés.
// Jetons d'accès : jamais stockés, renouvelés à la demande et gardés en mémoire jusqu'à une minute avant expiration.
// Journaux : étape et type d'erreur uniquement. Jamais de jeton, de code, d'état, de référence ni de réponse Google.
import { createHash, createHmac, randomBytes } from "node:crypto";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { providerJson, type FetchLike } from "@/lib/providers/api";
import { ProviderError } from "@/lib/providers/errors";
import { legacySearchConsoleConfigured, listSearchConsoleSites } from "@/lib/providers/search-console";
import { missingSearchConsoleConfiguration, searchConsoleKeyring, searchConsoleOAuthConfig, searchConsoleRedirectUri, type SearchConsoleOAuthConfig } from "@/lib/integrations/search-console/config";
import { createSearchConsoleVault, isSecretReference, supabaseSecretTable, type SearchConsoleVault } from "@/lib/integrations/search-console/vault";
import { SEARCH_CONSOLE_PROVIDER, SEARCH_CONSOLE_SCOPE, storedProperties, type DiscoveredProperty } from "@/lib/integrations/search-console/model";
import type { Json } from "@/lib/supabase/database.types";

type Env = Record<string, string | undefined>;
// Client Supabase serveur (typé) ou double de test au même contrat.
type Db = ReturnType<typeof getSupabaseServerClient>;
export type SearchConsoleDeps = { db: Db; config: SearchConsoleOAuthConfig | null; vault: SearchConsoleVault | null; pkceKey: Uint8Array | null; env: Env; fetchImpl?: FetchLike; now?: () => number; random?: () => string };

export function productionSearchConsoleDeps(): SearchConsoleDeps {
  const db = getSupabaseServerClient();
  const keyring = searchConsoleKeyring();
  return {
    db, env: process.env, config: searchConsoleOAuthConfig(),
    vault: keyring ? createSearchConsoleVault(supabaseSecretTable(db), keyring) : null,
    pkceKey: keyring ? createHmac("sha256", keyring.current.key).update("codev:search-console-oauth:pkce:v1").digest() : null,
  };
}

export const SEARCH_CONSOLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ALLOWED_SCOPES = new Set([SEARCH_CONSOLE_SCOPE, "https://www.googleapis.com/auth/webmasters"]);
const STATE = /^[A-Za-z0-9_-]{43}$/;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const base64url = (value: Uint8Array) => Buffer.from(value).toString("base64url");
const log = (step: string, error?: unknown) => console.error("[search-console]", { step, kind: error instanceof ProviderError ? error.kind : error ? "internal" : "none" });
const pkceVerifier = (key: Uint8Array, state: string) => base64url(createHmac("sha256", key).update(`pkce:${state}`).digest());

// ——— Connexion globale ———

export type SearchConsoleConnection = { id: string; status: string; reference: string | null; connectedAt: string | null; properties: DiscoveredProperty[]; discoveredAt: string | null; lastError: string | null; metadata: Record<string, unknown> };

export async function readSearchConsoleConnection(db: Db = getSupabaseServerClient()): Promise<SearchConsoleConnection | null> {
  const { data, error } = await db.from("client_connections").select("id,status,credential_reference,connected_at,metadata,last_error").eq("provider", SEARCH_CONSOLE_PROVIDER).is("client_id", null).maybeSingle();
  if (error) throw new Error("search console connection read");
  if (!data) return null;
  const metadata = data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata) ? data.metadata as Record<string, unknown> : {};
  return {
    id: data.id, status: data.status, reference: isSecretReference(data.credential_reference) ? data.credential_reference : null, connectedAt: data.connected_at,
    properties: storedProperties(metadata), discoveredAt: typeof metadata.discovered_at === "string" ? metadata.discovered_at : null, lastError: data.last_error ?? null, metadata,
  };
}

export type SearchConsoleStatus = {
  ready: boolean; missing: string[]; redirectUri: string | null; credentials: SearchConsoleOAuthConfig["credentials"] | null;
  connection: Omit<SearchConsoleConnection, "reference" | "metadata"> | null; legacy: boolean;
};

/** État affichable (aucune valeur secrète, seulement des noms de variables et l'état de la connexion). */
export async function searchConsoleStatus(deps: SearchConsoleDeps = productionSearchConsoleDeps()): Promise<SearchConsoleStatus> {
  const connection = await readSearchConsoleConnection(deps.db);
  const visible = connection ? { id: connection.id, status: connection.status, connectedAt: connection.connectedAt, properties: connection.properties, discoveredAt: connection.discoveredAt, lastError: connection.lastError } : null;
  return {
    ready: Boolean(deps.config && deps.vault && deps.pkceKey), missing: missingSearchConsoleConfiguration(deps.env), redirectUri: searchConsoleRedirectUri(deps.env),
    credentials: deps.config?.credentials ?? null, connection: visible, legacy: legacySearchConsoleConfigured(deps.env),
  };
}

// ——— Jetons ———

type TokenResponse = { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; scope?: unknown; token_type?: unknown };
const opaque = (value: unknown, max = 4096): value is string => typeof value === "string" && value.length >= 8 && value.length <= max && /^[\x21-\x7e]+$/.test(value);

/** Réponse du point de jeton Google validée : jeton porteur, durée explicite, scope Search Console en lecture, rien de plus. */
export function validateTokenResponse(body: TokenResponse, now: number) {
  const scopes = typeof body.scope === "string" ? body.scope.split(" ").filter(Boolean).slice(0, 20) : [];
  if (!opaque(body.access_token) || typeof body.token_type !== "string" || body.token_type.toLowerCase() !== "bearer" || typeof body.expires_in !== "number" || !Number.isFinite(body.expires_in) || body.expires_in <= 60) throw new ProviderError("search-console", "malformed");
  if (!scopes.includes(SEARCH_CONSOLE_SCOPE) || scopes.some((scope) => !ALLOWED_SCOPES.has(scope))) throw new ProviderError("search-console", "unauthorized", null, "scope_mismatch");
  return { accessToken: body.access_token, refreshToken: opaque(body.refresh_token) ? body.refresh_token : null, scopes, expiresAt: now + (body.expires_in - 60) * 1000 };
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();
const pendingRefresh = new Map<string, Promise<string>>();

async function markRevoked(db: Db, message: string) {
  await db.from("client_connections").update({ status: "revoked", last_error: message }).eq("provider", SEARCH_CONSOLE_PROVIDER).is("client_id", null).then(() => undefined, () => undefined);
}

/**
 * Source de jetons d'accès pour les appels Search Console. `null` : aucune connexion utilisable.
 * Connexion OAuth de CODE-V OS en priorité ; sinon ancien jeton serveur GOOGLE_SEARCH_CONSOLE_* (compatibilité).
 */
export async function searchConsoleAccess(deps: SearchConsoleDeps = productionSearchConsoleDeps()): Promise<{ source: "oauth" | "legacy"; accessToken?: () => Promise<string> } | null> {
  const connection = await readSearchConsoleConnection(deps.db);
  if (connection && connection.status === "active" && connection.reference && deps.config && deps.vault) {
    const reference = connection.reference, config = deps.config, vault = deps.vault, now = deps.now ?? Date.now;
    const refresh = async () => {
      const grant = await vault.read(reference).catch((error) => { log("vault_read", error); throw new ProviderError("search-console", "not_configured"); });
      let body: TokenResponse;
      try {
        body = await providerJson<TokenResponse>("search-console", TOKEN_URL, { method: "POST", fetchImpl: deps.fetchImpl, headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: grant.refreshToken, grant_type: "refresh_token" }) });
      } catch (error) {
        if (error instanceof ProviderError && error.code === "invalid_grant") {
          await markRevoked(deps.db, "Accès révoqué ou expiré côté Google : reconnectez Google Search Console.");
          throw new ProviderError("search-console", "unauthorized", error.status, "invalid_grant");
        }
        throw error;
      }
      const token = validateTokenResponse(body, now());
      tokenCache.set(reference, { token: token.accessToken, expiresAt: token.expiresAt });
      return token.accessToken;
    };
    return {
      source: "oauth",
      accessToken: () => {
        const cached = tokenCache.get(reference);
        if (cached && cached.expiresAt > now()) return Promise.resolve(cached.token);
        let pending = pendingRefresh.get(reference);
        if (!pending) { pending = refresh().finally(() => pendingRefresh.delete(reference)); pendingRefresh.set(reference, pending); }
        return pending;
      },
    };
  }
  if (legacySearchConsoleConfigured(deps.env)) return { source: "legacy" };
  return null;
}

// ——— OAuth ———

export type OAuthOutcome = "success" | "partial" | "refused" | "expired" | "invalid" | "unavailable" | "scope";
export const oauthOutcomeMessages: Record<OAuthOutcome, string> = {
  success: "Google Search Console est connecté.",
  partial: "Google Search Console est connecté, mais les propriétés n’ont pas pu être récupérées. Utilisez « Actualiser les propriétés ».",
  refused: "Autorisation refusée : Google Search Console n’est pas connecté.",
  expired: "Lien d’autorisation expiré : relancez la connexion.",
  invalid: "Lien d’autorisation invalide ou déjà utilisé.",
  scope: "Autorisation incomplète : l’accès en lecture à Search Console n’a pas été accordé.",
  unavailable: "Connexion impossible pour le moment.",
};
export const isOAuthOutcome = (value: unknown): value is OAuthOutcome => typeof value === "string" && Object.hasOwn(oauthOutcomeMessages, value);
export const oauthReturnPath = (outcome: OAuthOutcome) => `/settings?tab=connections&gsc=${outcome}`;

/** Démarrage : état aléatoire à usage unique (seule son empreinte est stockée, 10 minutes), URL Google officielle. */
export async function startSearchConsoleOAuth(userId: string, deps: SearchConsoleDeps = productionSearchConsoleDeps()): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  if (!deps.config || !deps.vault || !deps.pkceKey) return { ok: false, message: "Connexion indisponible : configuration OAuth incomplète côté serveur." };
  try {
    const state = deps.random ? deps.random() : base64url(randomBytes(32));
    if (!STATE.test(state)) throw new Error("state");
    const now = deps.now ?? Date.now;
    const { error } = await deps.db.from("integration_oauth_states").insert({ state_hash: hash(state), provider: SEARCH_CONSOLE_PROVIDER, actor_id: userId, expires_at: new Date(now() + 10 * 60_000).toISOString() });
    if (error) throw new Error("state");
    const challenge = base64url(createHash("sha256").update(pkceVerifier(deps.pkceKey, state)).digest());
    const params = new URLSearchParams({
      client_id: deps.config.clientId, redirect_uri: deps.config.redirectUri, response_type: "code", scope: SEARCH_CONSOLE_SCOPE,
      // Jeton de rafraîchissement propre à Search Console : aucun scope déjà accordé (Business Profile, Drive) n'y est ajouté.
      access_type: "offline", prompt: "consent", include_granted_scopes: "false", state, code_challenge: challenge, code_challenge_method: "S256",
    });
    return { ok: true, url: `${SEARCH_CONSOLE_AUTHORIZE}?${params}` };
  } catch (error) { log("start", error); return { ok: false, message: "Connexion impossible pour le moment." }; }
}

/** Callback : renvoie le chemin INTERNE de retour (jamais externe, jamais porteur d'une valeur Google). */
export async function completeSearchConsoleOAuth(userId: string, query: URLSearchParams, deps: SearchConsoleDeps = productionSearchConsoleDeps()): Promise<{ outcome: OAuthOutcome; connectionId: string | null; properties: number }> {
  const fail = (outcome: OAuthOutcome) => ({ outcome, connectionId: null, properties: 0 });
  const state = query.get("state");
  if (!state || !STATE.test(state)) return fail("invalid");
  const now = deps.now ?? Date.now;
  // État d'abord : usage unique (mise à jour conditionnelle), même administrateur, même fournisseur. Rien n'est échangé avant.
  const consumed = await deps.db.from("integration_oauth_states").update({ consumed_at: new Date(now()).toISOString() })
    .eq("state_hash", hash(state)).eq("provider", SEARCH_CONSOLE_PROVIDER).eq("actor_id", userId).is("consumed_at", null).select("expires_at");
  const row = !consumed.error && Array.isArray(consumed.data) && consumed.data.length === 1 ? consumed.data[0] as { expires_at: string } : null;
  if (!row) { log("state"); return fail("invalid"); }
  if (Date.parse(row.expires_at) <= now()) return fail("expired");
  const providerError = query.get("error");
  if (providerError) return fail(providerError === "access_denied" ? "refused" : "unavailable");
  const code = query.get("code");
  if (!code || code.length > 4096 || !/^[\x21-\x7e]+$/.test(code)) return fail("invalid");
  if (!deps.config || !deps.vault || !deps.pkceKey) return fail("unavailable");

  let token: ReturnType<typeof validateTokenResponse>;
  try {
    const body = await providerJson<TokenResponse>("search-console", TOKEN_URL, { method: "POST", fetchImpl: deps.fetchImpl, headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: deps.config.clientId, client_secret: deps.config.clientSecret, code, code_verifier: pkceVerifier(deps.pkceKey, state), redirect_uri: deps.config.redirectUri, grant_type: "authorization_code" }) });
    token = validateTokenResponse(body, now());
  } catch (error) {
    log("exchange", error);
    return fail(error instanceof ProviderError && error.code === "scope_mismatch" ? "scope" : error instanceof ProviderError && error.code === "invalid_grant" ? "expired" : "unavailable");
  }
  if (!token.refreshToken) { log("exchange_no_refresh"); return fail("unavailable"); }

  let reference: string;
  try { reference = await deps.vault.store({ refreshToken: token.refreshToken, scopes: token.scopes }); }
  catch (error) { log("vault_store", error); return fail("unavailable"); }

  const existing = await readSearchConsoleConnection(deps.db).catch(() => undefined);
  if (existing === undefined) { await deps.vault.remove(reference).catch(() => log("vault_cleanup")); return fail("unavailable"); }
  const connectedAt = new Date(now()).toISOString();
  const patch = { status: "active", credential_reference: reference, connected_at: connectedAt, scopes: token.scopes, last_error: null };
  const written = existing
    ? await deps.db.from("client_connections").update(patch).eq("id", existing.id).is("client_id", null).select("id")
    : await deps.db.from("client_connections").insert({ client_id: null, scope: "global", provider: SEARCH_CONSOLE_PROVIDER, metadata: {}, ...patch }).select("id");
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

async function discoverProperties(deps: SearchConsoleDeps, connectionId: string, metadata: Record<string, unknown>, accessToken: () => Promise<string>) {
  const properties = await listSearchConsoleSites({ accessToken, fetchImpl: deps.fetchImpl });
  const now = deps.now ?? Date.now;
  const { error } = await deps.db.from("client_connections").update({ metadata: { ...metadata, properties, discovered_at: new Date(now()).toISOString() } as unknown as Json }).eq("id", connectionId).is("client_id", null);
  if (error) throw new Error("properties write");
  return properties;
}

/** Nouvelle découverte des propriétés accessibles au compte connecté. */
export async function refreshSearchConsoleProperties(deps: SearchConsoleDeps = productionSearchConsoleDeps()): Promise<{ ok: true; count: number } | { ok: false; message: string }> {
  const connection = await readSearchConsoleConnection(deps.db);
  if (!connection || connection.status !== "active") return { ok: false, message: "Google Search Console n’est pas connecté." };
  const access = await searchConsoleAccess(deps);
  if (!access?.accessToken) return { ok: false, message: "Connexion indisponible : configuration OAuth incomplète côté serveur." };
  try {
    const properties = await discoverProperties(deps, connection.id, connection.metadata, access.accessToken);
    return { ok: true, count: properties.length };
  } catch (error) {
    log("discovery", error);
    return { ok: false, message: error instanceof ProviderError ? error.message : "Propriétés indisponibles pour le moment." };
  }
}

/**
 * Déconnexion locale : le jeton chiffré est supprimé et la connexion désactivée. L'autorisation n'est PAS révoquée
 * chez Google automatiquement : le client OAuth peut être partagé avec Google Business Profile, et une révocation
 * Google peut retirer l'accès de toute l'application pour ce compte. La révocation se fait, si besoin, depuis
 * https://myaccount.google.com/permissions en connaissance de cause.
 */
export async function disconnectSearchConsole(deps: SearchConsoleDeps = productionSearchConsoleDeps()): Promise<{ ok: boolean; message: string }> {
  const connection = await readSearchConsoleConnection(deps.db);
  if (!connection || connection.status === "disabled") return { ok: true, message: "Google Search Console était déjà déconnecté." };
  const { error } = await deps.db.from("client_connections").update({ status: "disabled", credential_reference: null, last_error: null }).eq("id", connection.id).is("client_id", null);
  if (error) throw new Error("search console disconnect");
  if (connection.reference) {
    tokenCache.delete(connection.reference);
    if (deps.vault) await deps.vault.remove(connection.reference).catch(() => log("vault_cleanup"));
  }
  return { ok: true, message: "Google Search Console est déconnecté. Les données déjà synchronisées sont conservées." };
}
