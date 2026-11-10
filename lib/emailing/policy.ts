import { createHmac, timingSafeEqual } from "node:crypto";

// Socle emailing : fonctions pures (aucun accès réseau ni base). Utilisées par le service, les routes publiques
// (désabonnement, webhook Resend) et les futurs envois (newsletters des clients, prospection CODE-V).

type Env = Record<string, string | undefined>;
export type SuppressionScope = { scope: "codev" } | { scope: "client"; clientId: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const address = /^[^\s@<>()",;:]{1,64}@[^\s@<>()",;:]{1,253}\.[a-z]{2,}$/;

/** Adresse en minuscules, sans espaces ; null si elle n'est pas une adresse plausible. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  return value.length >= 6 && value.length <= 254 && address.test(value) ? value : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Lien de désabonnement : jeton signé (HMAC-SHA256), sans échéance (un lien de désabonnement doit rester valable),
// dérivé de la clé serveur existante PUBLICATION_CREDENTIALS_KEY avec un libellé propre : aucune nouvelle variable.
export const UNSUBSCRIBE_PATH = "/api/email/unsubscribe";

function unsubscribeKey(env: Env): Buffer | null {
  const raw = env.PUBLICATION_CREDENTIALS_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  return key.length === 32 ? createHmac("sha256", key).update("codev:email-unsubscribe:v1").digest() : null;
}
const sign = (key: Buffer, payload: string) => createHmac("sha256", key).update(payload).digest("base64url");

export function unsubscribeToken(email: string, target: SuppressionScope, env: Env = process.env): string | null {
  const key = unsubscribeKey(env), normalized = normalizeEmail(email);
  if (!key || !normalized || (target.scope === "client" && !uuid.test(target.clientId))) return null;
  const payload = Buffer.from(JSON.stringify(target.scope === "client" ? { e: normalized, s: "client", c: target.clientId } : { e: normalized, s: "codev" })).toString("base64url");
  return `${payload}.${sign(key, payload)}`;
}

export function readUnsubscribeToken(token: unknown, env: Env = process.env): { email: string; target: SuppressionScope } | null {
  const match = typeof token === "string" ? /^([A-Za-z0-9_-]{10,1200})\.([A-Za-z0-9_-]{43})$/.exec(token) : null;
  const key = unsubscribeKey(env);
  if (!match || !key) return null;
  const expected = Buffer.from(sign(key, match[1])), given = Buffer.from(match[2]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let data: { e?: unknown; s?: unknown; c?: unknown };
  try { data = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8")); } catch { return null; }
  const email = normalizeEmail(data.e);
  if (!email) return null;
  if (data.s === "codev") return { email, target: { scope: "codev" } };
  if (data.s === "client" && typeof data.c === "string" && uuid.test(data.c)) return { email, target: { scope: "client", clientId: data.c } };
  return null;
}

/** En-têtes RFC 8058 (désabonnement en un clic), exigés par Gmail et Yahoo pour les envois en nombre. */
export function unsubscribeHeaders(email: string, target: SuppressionScope, baseUrl: string | null, env: Env = process.env): Record<string, string> | null {
  const token = unsubscribeToken(email, target, env);
  if (!token || !baseUrl || !/^https:\/\/[^/?#]+$/.test(baseUrl)) return null;
  return { "List-Unsubscribe": `<${baseUrl}${UNSUBSCRIBE_PATH}?t=${token}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}

// ---------------------------------------------------------------------------------------------------------------
// Webhook Resend (signature Svix) : contenu signé = `${svix-id}.${svix-timestamp}.${corps brut}`, clé = partie base64
// du secret `whsec_…`, en-tête `svix-signature` = liste « v1,<base64> » séparée par des espaces.
const TOLERANCE_SECONDS = 300;

export function validResendSignature(body: Uint8Array, headers: { id: string | null; timestamp: string | null; signature: string | null }, secret: string | undefined, now = Date.now()): boolean {
  if (!secret || !/^whsec_[A-Za-z0-9+/=]{16,200}$/.test(secret)) return false;
  const { id, timestamp, signature } = headers;
  if (!id || !/^[A-Za-z0-9_-]{1,200}$/.test(id) || !timestamp || !/^\d{1,12}$/.test(timestamp) || !signature || signature.length > 2000) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return false;
  const key = Buffer.from(secret.slice(6), "base64");
  if (key.length < 16) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.`).update(body).digest();
  return signature.split(" ").some((part) => {
    if (!part.startsWith("v1,")) return false;
    const given = Buffer.from(part.slice(3), "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export type ResendEventEffect = {
  type: string; providerMessageId: string | null; emails: string[]; occurredAt: string | null; detail: string | null;
  /** Exclusion globale à enregistrer pour chaque destinataire (rebond définitif ou plainte), sinon null. */
  suppress: "hard_bounce" | "complaint" | null;
};

/** Lit un événement Resend (email.sent, email.delivered, email.bounced, email.complained…) ; null si illisible. */
export function readResendEvent(payload: unknown): ResendEventEffect | null {
  if (!payload || typeof payload !== "object") return null;
  const event = payload as { type?: unknown; created_at?: unknown; data?: { email_id?: unknown; to?: unknown; bounce?: { type?: unknown; subType?: unknown } } };
  if (typeof event.type !== "string" || !/^[a-z_]{1,30}\.[a-z_]{1,30}$/.test(event.type) || !event.data || typeof event.data !== "object") return null;
  const to = Array.isArray(event.data.to) ? event.data.to : typeof event.data.to === "string" ? [event.data.to] : [];
  const emails = [...new Set(to.map(normalizeEmail).filter((value): value is string => value !== null))].slice(0, 50);
  const providerMessageId = typeof event.data.email_id === "string" && event.data.email_id.length <= 200 ? event.data.email_id : null;
  const occurredAt = typeof event.created_at === "string" && !Number.isNaN(Date.parse(event.created_at)) ? new Date(event.created_at).toISOString() : null;
  const bounceType = typeof event.data.bounce?.type === "string" ? event.data.bounce.type : null;
  const subType = typeof event.data.bounce?.subType === "string" ? event.data.bounce.subType : null;
  // Seuls les rebonds définitifs excluent l'adresse ; un rebond temporaire (boîte pleine…) est seulement consigné.
  const suppress = event.type === "email.complained" ? "complaint" : event.type === "email.bounced" && bounceType === "Permanent" ? "hard_bounce" : null;
  const detail = bounceType ? `${bounceType}${subType ? ` / ${subType}` : ""}`.slice(0, 500) : null;
  return { type: event.type, providerMessageId, emails, occurredAt, detail, suppress };
}

// ---------------------------------------------------------------------------------------------------------------
/** Un envoi est bloqué si l'adresse est exclue globalement ou pour la portée de l'expéditeur. */
export function isBlockedBy(rows: { scope: string; client_id: string | null }[], target: SuppressionScope): boolean {
  return rows.some((row) => row.scope === "global" || (row.scope === target.scope && (target.scope === "codev" || row.client_id === target.clientId)));
}
