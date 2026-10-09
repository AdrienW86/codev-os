import "server-only";
// Envoi d'e-mails (Resend). Double verrou : fournisseur configuré ET EMAIL_SENDING_ENABLED=true.
// Tant que ce n'est pas le cas, aucun e-mail réel ne part (rapports : envoi manuel consigné).
import { providerJson } from "@/lib/providers/api";
import { ProviderError } from "@/lib/providers/errors";

type Env = Record<string, string | undefined>;

export function emailSendingStatus(env: Env = process.env): { enabled: true } | { enabled: false; reason: string } {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return { enabled: false, reason: "Envoi e-mail non configuré (RESEND_API_KEY, EMAIL_FROM). Consignez un envoi manuel." };
  if (env.EMAIL_SENDING_ENABLED !== "true") return { enabled: false, reason: "Envoi e-mail désactivé (EMAIL_SENDING_ENABLED ≠ true). Consignez un envoi manuel." };
  return { enabled: true };
}

const address = /^[^\s@<>()",;:]{1,64}@[^\s@<>()",;:]{1,253}\.[a-z]{2,}$/i;

export async function sendEmail(message: { to: string; subject: string; text: string; idempotencyKey: string }, env: Env = process.env, fetchImpl?: typeof fetch) {
  const status = emailSendingStatus(env);
  if (!status.enabled) throw new ProviderError("email", "not_configured");
  if (!address.test(message.to) || !address.test(env.EMAIL_FROM!.replace(/^.*<|>$/g, ""))) throw new ProviderError("email", "malformed");
  const data = await providerJson<{ id?: unknown }>("email", "https://api.resend.com/emails", {
    method: "POST", fetchImpl,
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": message.idempotencyKey.slice(0, 200) },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [message.to], subject: message.subject.slice(0, 200), text: message.text.slice(0, 100_000) }),
  });
  if (typeof data.id !== "string") throw new ProviderError("email", "malformed");
  return { id: data.id };
}
