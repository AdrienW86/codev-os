import { normalizeEmail } from "@/lib/emailing/policy";

// Réponses aux e-mails de prospection (fonctions pures). Reçues par Resend (réception entrante, webhook
// « email.received ») sur l'adresse du domaine dédié : une demande d'arrêt est appliquée tout de suite et
// définitivement (droit d'opposition), toute vraie réponse arrête la séquence (pas de relance), une réponse
// automatique (absence) est seulement consignée.

export type ReplyKind = "reply" | "stop" | "auto_reply";
export type InboundEmail = { emailId: string | null; from: string | null; to: string[]; subject: string };

/** Lit l'événement « email.received » ; null s'il est d'un autre type ou illisible. */
export function readInboundEmail(payload: unknown): InboundEmail | null {
  const event = payload as { type?: unknown; data?: { email_id?: unknown; from?: unknown; to?: unknown; subject?: unknown } } | null;
  if (!event || event.type !== "email.received" || !event.data || typeof event.data !== "object") return null;
  const address = (value: unknown) => typeof value === "string" ? normalizeEmail(value.replace(/^.*<|>.*$/g, "")) : null;
  const to = (Array.isArray(event.data.to) ? event.data.to : [event.data.to]).map(address).filter((v): v is string => Boolean(v)).slice(0, 10);
  const emailId = typeof event.data.email_id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(event.data.email_id) ? event.data.email_id : null;
  const subject = typeof event.data.subject === "string" ? event.data.subject.replace(/[\r\n\t]+/g, " ").slice(0, 300) : "";
  return { emailId, from: address(event.data.from), to, subject };
}

/** Texte nouveau d'une réponse : sans les lignes citées ni le message d'origine. */
export function newReplyText(text: string): string {
  const lines: string[] = [];
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*>/.test(line)) continue;
    if (/^\s*(le .{3,120} a écrit\s*:|on .{3,120} wrote\s*:|-{2,}\s*(message d'origine|original message)|de\s*:\s|from\s*:\s)/i.test(line)) break;
    lines.push(line);
  }
  return lines.join("\n").trim().slice(0, 4000);
}

const AUTO_SUBJECT = /^\s*(réponse automatique|reponse automatique|automatic reply|auto(-|\s)?reply|absence|absent|out of (the )?office|en congés?|message d'absence)/i;
const STOP = /(?<![\p{L}\p{N}])(stop|unsubscribe|désinscri\p{L}*|desinscri\p{L}*|désabonn\p{L}*|desabonn\p{L}*|retirez[- ]moi|retirez[- ]nous|supprimez (mon|notre|cette) adresse|ne (plus|pas) (me |nous )?(contacter|écrire|ecrire|solliciter|recevoir)|pas intéressée?s?|pas interessee?s?|aucun intérêt|aucun interet)(?![\p{L}\p{N}])/iu;

/** Classe une réponse : demande d'arrêt, réponse automatique ou vraie réponse. */
export function classifyReply(input: { subject: string; text: string | null; autoSubmitted?: string | null }): ReplyKind {
  const auto = input.autoSubmitted && input.autoSubmitted.toLowerCase() !== "no";
  const fresh = newReplyText(input.text ?? "");
  // Une demande d'arrêt l'emporte toujours, même dans un message automatique ou au seul objet.
  if (STOP.test(fresh.slice(0, 600)) || STOP.test(input.subject.replace(/^\s*(re|ré|tr|fwd?)\s*:\s*/gi, ""))) return "stop";
  if (auto || AUTO_SUBJECT.test(input.subject)) return "auto_reply";
  return "reply";
}

/** Extrait conservé avec le message (lecture dans l'écran) : texte nouveau, borné. */
export const replyExcerpt = (text: string | null) => newReplyText(text ?? "").replace(/\n{3,}/g, "\n\n").slice(0, 1000) || null;
