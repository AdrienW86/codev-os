import { z } from "zod";
import { normalizeEmail } from "./policy";

// Expéditeur et domaine d'envoi de chaque client (fonctions pures, aucun accès réseau ni base).
// Une newsletter part au nom du client (« Toitures Martin <newsletter@news.toitures-martin.fr> ») seulement quand son
// domaine est vérifié chez Resend (SPF, DKIM) ; sinon, l'adresse commune EMAIL_FROM reste utilisée.

const domainPattern = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Nom de domaine en minuscules, sans protocole ni chemin ; null s'il n'est pas valide. */
export function normalizeDomain(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#:].*$/, "").replace(/\.$/, "");
  return value.length >= 4 && value.length <= 253 && domainPattern.test(value) ? value : null;
}

/** Sous-domaine d'envoi proposé à partir du site du client (news.exemple.fr) : la réputation du domaine principal reste protégée. */
export function suggestSendingDomain(website: string | null | undefined): string | null {
  const host = normalizeDomain(website ?? "");
  return host ? normalizeDomain(`news.${host.replace(/^www\./, "")}`) : null;
}

export const DOMAIN_STATUS = { not_started: "Non vérifié", pending: "Vérification en cours", verified: "Vérifié", failed: "Échec de vérification", temporary_failure: "Échec temporaire" } as const;
export type DomainStatus = keyof typeof DOMAIN_STATUS;
export const domainStatus = (value: unknown): DomainStatus => (typeof value === "string" && Object.hasOwn(DOMAIN_STATUS, value) ? value as DomainStatus : "not_started");

export type DnsRecord = { record: string; type: string; name: string; value: string; priority: number | null; status: DomainStatus };

/** Enregistrements DNS renvoyés par Resend, filtrés (types connus, longueurs bornées) avant stockage et affichage. */
export function readDnsRecords(raw: unknown): DnsRecord[] {
  if (!Array.isArray(raw)) return [];
  const text = (value: unknown, max: number) => (typeof value === "string" && value.length > 0 && value.length <= max && !/[\r\n\x00<>]/.test(value) ? value : null);
  return raw.slice(0, 12).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const type = text(row.type, 10)?.toUpperCase(), name = text(row.name, 253), value = text(row.value, 2000);
    if (!type || !["TXT", "MX", "CNAME"].includes(type) || !name || !value) return [];
    const record = text(row.record, 30);
    return [{ record: record && /^[A-Za-z ]+$/.test(record) ? record : type, type, name, value,
      priority: typeof row.priority === "number" && Number.isInteger(row.priority) && row.priority >= 0 && row.priority <= 65535 ? row.priority : null, status: domainStatus(row.status) }];
  });
}

export const senderSchema = z.object({
  sending_domain: z.string().transform((value, ctx) => { const domain = normalizeDomain(value); if (!domain) { ctx.addIssue({ code: "custom", message: "Domaine d'envoi invalide (ex. news.exemple.fr)." }); return z.NEVER; } return domain; }),
  from_name: z.string().trim().min(1, "Nom d'expéditeur requis.").max(80).refine((value) => !/[<>"\r\n\x00]/.test(value), "Caractères non autorisés dans le nom."),
  from_local_part: z.string().trim().toLowerCase().regex(/^[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$/, "Partie avant @ invalide (ex. newsletter)."),
  reply_to: z.string().transform((value, ctx) => { if (!value.trim()) return null; const email = normalizeEmail(value); if (!email) { ctx.addIssue({ code: "custom", message: "Adresse de réponse invalide." }); return z.NEVER; } return email; }),
});
export type SenderInput = z.infer<typeof senderSchema>;

export type SenderSettings = {
  sending_domain: string | null; from_name: string | null; from_local_part: string; reply_to: string | null;
  provider_domain_id: string | null; domain_status: DomainStatus; dns_records: DnsRecord[]; domain_checked_at: string | null;
};

/** Expéditeur du client, ou null tant que son domaine n'est pas vérifié (l'envoi utilise alors EMAIL_FROM). */
export function clientSender(settings: SenderSettings | null): { from: string; replyTo: string | null } | null {
  if (!settings || settings.domain_status !== "verified" || !settings.sending_domain || !settings.from_name) return null;
  const domain = normalizeDomain(settings.sending_domain), name = settings.from_name.replace(/[<>"\r\n\x00]/g, "").trim();
  if (!domain || !name || !/^[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$/.test(settings.from_local_part)) return null;
  return { from: `${name} <${settings.from_local_part}@${domain}>`, replyTo: normalizeEmail(settings.reply_to) };
}

export function senderFromRow(row: Record<string, unknown> | null): SenderSettings | null {
  if (!row) return null;
  const text = (value: unknown) => (typeof value === "string" && value ? value : null);
  return {
    sending_domain: normalizeDomain(row.sending_domain), from_name: text(row.from_name), from_local_part: text(row.from_local_part) ?? "newsletter",
    reply_to: normalizeEmail(row.reply_to), provider_domain_id: text(row.provider_domain_id), domain_status: domainStatus(row.domain_status),
    dns_records: readDnsRecords(row.dns_records), domain_checked_at: text(row.domain_checked_at),
  };
}
