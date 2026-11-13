import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { providerJson, type FetchLike } from "@/lib/providers/api";
import { ProviderError } from "@/lib/providers/errors";
import { ga4OAuthConfig, ga4Keyring, ga4RedirectUri, missingGa4Configuration, type Ga4OAuthConfig } from "@/lib/integrations/ga4/config";
import { createGa4Vault, isSecretReference, supabaseSecretTable, type Ga4Vault } from "@/lib/integrations/ga4/vault";
import { discoverGa4Properties } from "@/lib/integrations/ga4/api";
import { GA4_PROVIDER, GA4_SCOPE, storedGa4Properties, type Ga4Property } from "@/lib/integrations/ga4/model";
import type { Json } from "@/lib/supabase/database.types";

type Db = ReturnType<typeof getSupabaseServerClient>;
export type Ga4Deps = { db: Db; config: Ga4OAuthConfig | null; vault: Ga4Vault | null; pkceKey: Uint8Array | null; fetchImpl?: FetchLike; now?: () => number; random?: () => string };
export function ga4Deps(): Ga4Deps {
  const db = getSupabaseServerClient(), keyring = ga4Keyring();
  return {
    db, config: ga4OAuthConfig(), vault: keyring ? createGa4Vault(supabaseSecretTable(db), keyring) : null,
    pkceKey: keyring ? createHmac("sha256", keyring.current.key).update("codev:ga4-oauth:pkce:v1").digest() : null,
  };
}
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const STATE = /^[A-Za-z0-9_-]{43}$/;
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const verifier = (key: Uint8Array, state: string) => createHmac("sha256", key).update(`pkce:${state}`).digest("base64url");
const log = (step: string, e?: unknown) => console.error("[google-analytics]", { step, kind: e instanceof ProviderError ? e.kind : e ? "internal" : "none" });

export type Ga4Connection = { id: string; status: string; reference: string | null; properties: Ga4Property[]; connectedAt: string | null; lastError: string | null; metadata: Record<string, unknown> };
export async function readGa4Connection(db: Db = getSupabaseServerClient()): Promise<Ga4Connection | null> {
  const { data, error } = await db.from("client_connections").select("id,status,credential_reference,metadata,connected_at,last_error")
    .eq("provider", GA4_PROVIDER).is("client_id", null).maybeSingle();
  if (error) throw new Error("GA4 connection read");
  if (!data) return null;
  const metadata = data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata) ? data.metadata as Record<string, unknown> : {};
  return {
    id: data.id, status: data.status, reference: isSecretReference(data.credential_reference) ? data.credential_reference : null,
    properties: storedGa4Properties(metadata), connectedAt: data.connected_at, lastError: data.last_error ?? null, metadata,
  };
}
export async function ga4Status(deps: Ga4Deps = ga4Deps()) {
  const conn = await readGa4Connection(deps.db);
  return {
    ready: Boolean(deps.config && deps.vault && deps.pkceKey), missing: missingGa4Configuration(), redirectUri: ga4RedirectUri(),
    credentials: deps.config?.credentials ?? null,
    connection: conn ? { id: conn.id, status: conn.status, properties: conn.properties, connectedAt: conn.connectedAt, lastError: conn.lastError } : null,
  };
}
type TokenBody = { access_token?: unknown; refresh_token?: unknown; token_type?: unknown; expires_in?: unknown; scope?: unknown };
const opaque = (v: unknown): v is string => typeof v === "string" && v.length >= 8 && v.length <= 4096 && /^[\x21-\x7e]+$/.test(v);
function validToken(body: TokenBody, requireScope: boolean, now: number) {
  if (!opaque(body.access_token) || typeof body.token_type !== "string" || body.token_type.toLowerCase() !== "bearer" ||
      typeof body.expires_in !== "number" || !Number.isFinite(body.expires_in) || body.expires_in <= 60)
    throw new ProviderError(GA4_PROVIDER, "malformed");
  const scopes = typeof body.scope === "string" ? body.scope.split(" ").filter(Boolean) : [];
  if (requireScope && (scopes.length !== 1 || scopes[0] !== GA4_SCOPE)) throw new ProviderError(GA4_PROVIDER, "unauthorized", null, "scope_mismatch");
  return {
    accessToken: body.access_token, refreshToken: opaque(body.refresh_token) ? body.refresh_token : null,
    scopes, expiresAt: now + (body.expires_in - 60) * 1000,
  };
}
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
const pending = new Map<string, Promise<string>>();
export async function ga4AccessToken(deps: Ga4Deps = ga4Deps()): Promise<string | null> {
  const conn = await readGa4Connection(deps.db);
  if (!conn || conn.status !== "active" || !conn.reference || !deps.config || !deps.vault) return null;
  const reference = conn.reference, cached = tokenCache.get(reference), now = deps.now ?? Date.now;
  if (cached && cached.expiresAt > now()) return cached.token;
  let active = pending.get(reference);
  if (!active) {
    active = (async () => {
      const grant = await deps.vault!.read(reference).catch(() => { throw new ProviderError(GA4_PROVIDER, "not_configured"); });
      if (!grant.scopes.includes(GA4_SCOPE)) throw new ProviderError(GA4_PROVIDER, "unauthorized");
      let body: TokenBody;
      try {
        body = await providerJson<TokenBody>(GA4_PROVIDER, TOKEN_URL, {
          method: "POST", fetchImpl: deps.fetchImpl, headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ client_id: deps.config!.clientId, client_secret: deps.config!.clientSecret, refresh_token: grant.refreshToken, grant_type: "refresh_token" }),
        });
      } catch (e) {
        if (e instanceof ProviderError && e.code === "invalid_grant") {
          await deps.db.from("client_connections").update({ status: "revoked", last_error: "Accès Google Analytics révoqué : reconnectez." })
            .eq("id", conn.id).is("client_id", null);
        }
        throw e;
      }
      const token = validToken(body, false, now());
      tokenCache.set(reference, { token: token.accessToken, expiresAt: token.expiresAt });
      return token.accessToken;
    })().finally(() => pending.delete(reference));
    pending.set(reference, active);
  }
  return active;
}

export const ga4Outcomes = {
  success: "Google Analytics est connecté.", partial: "Google Analytics est connecté mais les propriétés doivent être actualisées.",
  refused: "Autorisation Google refusée.", expired: "Autorisation expirée, recommencez.",
  invalid: "Lien d'autorisation invalide ou déjà utilisé.", unavailable: "Connexion GA4 indisponible.",
  scope: "L'autorisation analytics.readonly n'a pas été accordée.",
} as const;
export type Ga4Outcome = keyof typeof ga4Outcomes;
export const isGa4Outcome = (v: unknown): v is Ga4Outcome => typeof v === "string" && Object.hasOwn(ga4Outcomes, v);

export async function startGa4OAuth(userId: string, deps: Ga4Deps = ga4Deps()): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  if (!deps.config || !deps.vault || !deps.pkceKey) return { ok: false, message: "Configuration serveur Google Analytics incomplète." };
  try {
    const state = deps.random?.() ?? randomBytes(32).toString("base64url");
    if (!STATE.test(state)) throw new Error("state");
    const now = deps.now ?? Date.now;
    const { error } = await deps.db.from("integration_oauth_states").insert({
      state_hash: hash(state), provider: GA4_PROVIDER, actor_id: userId, expires_at: new Date(now() + 600000).toISOString(),
    });
    if (error) throw new Error("oauth_state");
    const params = new URLSearchParams({
      client_id: deps.config.clientId, redirect_uri: deps.config.redirectUri, response_type: "code", scope: GA4_SCOPE,
      access_type: "offline", prompt: "consent", include_granted_scopes: "false", state,
      code_challenge: createHash("sha256").update(verifier(deps.pkceKey, state)).digest("base64url"),
      code_challenge_method: "S256",
    });
    return { ok: true, url: `${AUTHORIZE_URL}?${params}` };
  } catch (e) { log("start", e); return { ok: false, message: "Connexion GA4 indisponible." }; }
}
export async function completeGa4OAuth(userId: string, query: URLSearchParams, deps: Ga4Deps = ga4Deps()): Promise<{ outcome: Ga4Outcome; connectionId: string | null; properties: number }> {
  const fail = (outcome: Ga4Outcome) => ({ outcome, connectionId: null, properties: 0 });
  const state = query.get("state");
  if (!state || !STATE.test(state)) return fail("invalid");
  const now = deps.now ?? Date.now;
  const consumed = await deps.db.from("integration_oauth_states")
    .update({ consumed_at: new Date(now()).toISOString() })
    .eq("state_hash", hash(state)).eq("provider", GA4_PROVIDER).eq("actor_id", userId).is("consumed_at", null).select("expires_at");
  const row = !consumed.error && consumed.data?.length === 1 ? consumed.data[0] : null;
  if (!row) return fail("invalid");
  if (Date.parse(row.expires_at) <= now()) return fail("expired");
  const errorCode = query.get("error");
  if (errorCode) return fail(errorCode === "access_denied" ? "refused" : "unavailable");
  const code = query.get("code");
  if (!code || code.length > 4096 || !/^[\x21-\x7e]+$/.test(code) || !deps.config || !deps.vault || !deps.pkceKey) return fail("invalid");
  let token: ReturnType<typeof validToken>;
  try {
    const body = await providerJson<TokenBody>(GA4_PROVIDER, TOKEN_URL, {
      method: "POST", fetchImpl: deps.fetchImpl, headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: deps.config.clientId, client_secret: deps.config.clientSecret, code,
        code_verifier: verifier(deps.pkceKey, state), redirect_uri: deps.config.redirectUri, grant_type: "authorization_code" }),
    });
    token = validToken(body, true, now());
  } catch (e) { log("exchange", e); return fail(e instanceof ProviderError && e.code === "scope_mismatch" ? "scope" : "unavailable"); }
  if (!token.refreshToken) return fail("unavailable");
  let reference: string;
  try { reference = await deps.vault.store({ refreshToken: token.refreshToken, scopes: token.scopes }); }
  catch (e) { log("vault", e); return fail("unavailable"); }
  const existing = await readGa4Connection(deps.db).catch(() => undefined);
  if (existing === undefined) { await deps.vault.remove(reference).catch(() => undefined); return fail("unavailable"); }
  const patch = { status: "active", credential_reference: reference, connected_at: new Date(now()).toISOString(), scopes: token.scopes, last_error: null };
  const written = existing
    ? await deps.db.from("client_connections").update(patch).eq("id", existing.id).is("client_id", null).select("id")
    : await deps.db.from("client_connections").insert({ client_id: null, scope: "global", provider: GA4_PROVIDER, metadata: {}, ...patch }).select("id");
  const id = !written.error && written.data?.length === 1 ? written.data[0].id : null;
  if (!id) { await deps.vault.remove(reference).catch(() => undefined); return fail("unavailable"); }
  if (existing?.reference && existing.reference !== reference) {
    tokenCache.delete(existing.reference);
    await deps.vault.remove(existing.reference).catch(() => log("cleanup"));
  }
  tokenCache.set(reference, { token: token.accessToken, expiresAt: token.expiresAt });
  try {
    const properties = await saveGa4Properties(id, existing?.metadata ?? {}, token.accessToken, deps);
    return { outcome: "success", connectionId: id, properties: properties.length };
  } catch (e) { log("properties", e); return { outcome: "partial", connectionId: id, properties: 0 }; }
}
async function saveGa4Properties(id: string, metadata: Record<string, unknown>, token: string, deps: Ga4Deps) {
  const properties = await discoverGa4Properties(token, deps.fetchImpl);
  const { error } = await deps.db.from("client_connections").update({
    metadata: { ...metadata, properties, discovered_at: new Date((deps.now ?? Date.now)()).toISOString() } as Json,
  }).eq("id", id).is("client_id", null);
  if (error) throw new Error("GA4 property cache");
  return properties;
}
export async function refreshGa4Properties(deps: Ga4Deps = ga4Deps()) {
  const conn = await readGa4Connection(deps.db);
  if (!conn || conn.status !== "active") return { ok: false, message: "Google Analytics n'est pas connecté." };
  try {
    const token = await ga4AccessToken(deps);
    if (!token) return { ok: false, message: "Accès Google Analytics indisponible." };
    const properties = await saveGa4Properties(conn.id, conn.metadata, token, deps);
    return { ok: true, message: `${properties.length} propriétés Google Analytics accessibles.` };
  } catch (e) { log("refresh", e); return { ok: false, message: "Actualisation des propriétés GA4 impossible." }; }
}
export async function disconnectGa4(deps: Ga4Deps = ga4Deps()) {
  const conn = await readGa4Connection(deps.db);
  if (!conn || conn.status === "disabled") return { ok: true, message: "Google Analytics était déjà déconnecté." };
  const { error } = await deps.db.from("client_connections").update({ status: "disabled", credential_reference: null, last_error: null })
    .eq("id", conn.id).is("client_id", null);
  if (error) throw new Error("GA4 disconnect");
  if (conn.reference) {
    tokenCache.delete(conn.reference);
    await deps.vault?.remove(conn.reference).catch(() => log("cleanup"));
  }
  return { ok: true, message: "Google Analytics déconnecté. L'historique reste conservé dans CODE-V OS." };
}
