import { z } from "zod";
import { normalizeEmail } from "@/lib/emailing/policy";
import { domainStatus, normalizeDomain, readDnsRecords, type DnsRecord, type DomainStatus } from "@/lib/emailing/sender";

// Expéditeur de prospection (fonctions pures, aucun accès réseau ni base).
// La prospection à froid part TOUJOURS d'un domaine dédié, jamais du domaine principal (site, rapports, newsletters) :
// une vague de plaintes ou de rebonds ne doit abîmer que ce domaine-là. Domaine séparé recommandé (ex. code-v-pro.fr),
// sous-domaine accepté avec avertissement (sa réputation reste en partie liée au domaine principal).

type Env = Record<string, string | undefined>;

/** Suffixes publics à deux niveaux les plus courants (le reste : deux derniers libellés). */
const TWO_LEVEL_SUFFIXES = new Set(["co.uk", "org.uk", "gouv.fr", "asso.fr", "com.fr", "co.fr", "com.au", "co.nz", "com.br"]);

/** Domaine enregistrable (exemple.fr pour news.exemple.fr). */
export function registrableDomain(raw: string): string | null {
  const domain = normalizeDomain(raw);
  if (!domain) return null;
  const parts = domain.replace(/^www\./, "").split(".");
  const take = parts.length >= 3 && TWO_LEVEL_SUFFIXES.has(parts.slice(-2).join(".")) ? 3 : 2;
  return parts.slice(-take).join(".");
}

/** Domaine d'une adresse (« Nom <a@b.fr> » ou « a@b.fr »). */
export function domainOfAddress(raw: string | null | undefined): string | null {
  const email = normalizeEmail((raw ?? "").replace(/^.*<|>$/g, ""));
  return email ? normalizeDomain(email.split("@")[1]) : null;
}

/** Domaines à protéger : celui d'EMAIL_FROM (rapports, newsletters), le site et le domaine de newsletter du client. */
export function protectedDomains(env: Env, extra: (string | null | undefined)[] = []): string[] {
  const list = [domainOfAddress(env.EMAIL_FROM), ...extra.map((value) => normalizeDomain(value ?? ""))];
  return [...new Set(list.filter((value): value is string => Boolean(value)).map((value) => value.replace(/^www\./, "")))];
}

export type DomainCheck =
  | { ok: true; kind: "separate" }
  | { ok: true; kind: "subdomain"; warning: string }
  | { ok: false; reason: string };

/** Refuse un domaine de prospection égal à un domaine protégé ; avertit pour un sous-domaine d'un domaine protégé. */
export function checkProspectingDomain(rawDomain: string, protectedList: string[]): DomainCheck {
  const domain = normalizeDomain(rawDomain);
  if (!domain) return { ok: false, reason: "Domaine d'envoi invalide (ex. code-v-pro.fr)." };
  const root = registrableDomain(domain);
  for (const value of protectedList) {
    const protectedDomain = normalizeDomain(value)?.replace(/^www\./, "");
    if (!protectedDomain) continue;
    if (domain === protectedDomain) return { ok: false, reason: `${domain} est déjà utilisé (site, rapports ou newsletters) : la prospection doit partir d'un domaine dédié.` };
    if (domain.endsWith(`.${protectedDomain}`) && protectedDomain.split(".").length > (registrableDomain(protectedDomain) ?? "").split(".").length)
      return { ok: false, reason: `${domain} est un sous-domaine de ${protectedDomain}, déjà utilisé pour d'autres envois : choisissez un domaine dédié.` };
  }
  if (root && protectedList.some((value) => registrableDomain(value) === root) && domain !== root)
    return { ok: true, kind: "subdomain", warning: `Sous-domaine de ${root} accepté, mais sa réputation reste en partie liée à ${root}. Un domaine séparé (ex. ${root.replace(/\.[a-z]+$/, "")}-pro.fr) protège mieux l'adresse principale.` };
  if (root && protectedList.some((value) => registrableDomain(value) === root))
    return { ok: false, reason: `${domain} est le domaine principal : la prospection doit partir d'un domaine dédié.` };
  return { ok: true, kind: "separate" };
}

const singleLine = (max: number, message: string) => z.string().trim().min(1, message).max(max).refine((value) => !/[<>"\r\n\x00]/.test(value), "Caractères non autorisés.");

export const prospectingSenderSchema = z.object({
  sending_domain: z.string().transform((value, ctx) => { const domain = normalizeDomain(value); if (!domain) { ctx.addIssue({ code: "custom", message: "Domaine d'envoi invalide (ex. code-v-pro.fr)." }); return z.NEVER; } return domain; }),
  from_name: singleLine(80, "Nom d'expéditeur requis."),
  from_local_part: z.string().trim().toLowerCase().regex(/^[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$/, "Partie avant @ invalide (ex. contact)."),
  reply_to: z.string().transform((value, ctx) => { if (!value.trim()) return null; const email = normalizeEmail(value); if (!email) { ctx.addIssue({ code: "custom", message: "Adresse de réponse invalide." }); return z.NEVER; } return email; }),
  legal_name: singleLine(160, "Raison sociale requise (mention légale de chaque message)."),
  legal_address: singleLine(240, "Adresse postale requise (mention légale de chaque message)."),
  privacy_url: z.string().transform((value, ctx) => {
    if (!value.trim()) return null;
    try { const url = new URL(value.trim()); if (url.protocol === "https:" && !url.username && !url.password && url.hostname.includes(".")) return url.toString(); } catch { /* invalide */ }
    ctx.addIssue({ code: "custom", message: "Lien de politique de confidentialité invalide (https://…)." }); return z.NEVER;
  }),
});
export type ProspectingSenderInput = z.infer<typeof prospectingSenderSchema>;

export type ProspectingSender = {
  id: string; workspace_id: string; address: string; status: string; daily_limit: number;
  sending_domain: string | null; from_name: string | null; reply_to: string | null;
  legal_name: string | null; legal_address: string | null; privacy_url: string | null;
  provider_domain_id: string | null; domain_status: DomainStatus; dns_records: DnsRecord[]; domain_checked_at: string | null;
  warmup_started_at: string | null;
};

export const PROSPECTING_SENDER_COLUMNS = "id,workspace_id,address,provider,status,daily_limit,sending_domain,from_name,reply_to,legal_name,legal_address,privacy_url,provider_domain_id,domain_status,dns_records,domain_checked_at,warmup_started_at";

export function prospectingSenderFromRow(row: Record<string, unknown> | null): ProspectingSender | null {
  if (!row || row.provider !== "resend" || typeof row.id !== "string" || typeof row.workspace_id !== "string") return null;
  const text = (value: unknown) => (typeof value === "string" && value ? value : null);
  return {
    id: row.id, workspace_id: row.workspace_id, address: text(row.address) ?? "", status: text(row.status) ?? "unconfigured",
    daily_limit: typeof row.daily_limit === "number" ? row.daily_limit : 0,
    sending_domain: normalizeDomain(row.sending_domain), from_name: text(row.from_name), reply_to: normalizeEmail(row.reply_to),
    legal_name: text(row.legal_name), legal_address: text(row.legal_address), privacy_url: text(row.privacy_url),
    provider_domain_id: text(row.provider_domain_id), domain_status: domainStatus(row.domain_status), dns_records: readDnsRecords(row.dns_records),
    domain_checked_at: text(row.domain_checked_at), warmup_started_at: text(row.warmup_started_at),
  };
}

export type ResolvedProspectingSender = { from: string; replyTo: string | null; domain: string; legalName: string; legalAddress: string; privacyUrl: string | null };

/**
 * Expéditeur utilisable pour un envoi : domaine vérifié chez Resend, statut prêt, mention légale complète, et domaine
 * toujours distinct des domaines protégés (contrôle refait à chaque envoi). Sinon null : aucun envoi.
 */
export function resolveProspectingSender(sender: ProspectingSender | null, protectedList: string[]): ResolvedProspectingSender | null {
  if (!sender || sender.status !== "ready" || sender.domain_status !== "verified" || !sender.sending_domain || !sender.from_name || !sender.legal_name || !sender.legal_address) return null;
  if (!checkProspectingDomain(sender.sending_domain, protectedList).ok) return null;
  const email = normalizeEmail(sender.address);
  if (!email || domainOfAddress(email) !== sender.sending_domain) return null;
  const name = sender.from_name.replace(/[<>"\r\n\x00]/g, "").trim();
  if (!name) return null;
  return { from: `${name} <${email}>`, replyTo: sender.reply_to, domain: sender.sending_domain, legalName: sender.legal_name, legalAddress: sender.legal_address, privacyUrl: sender.privacy_url };
}

/** Enregistrement DMARC conseillé (Resend ne le fournit pas) : surveillance d'abord, durcissement après quelques semaines. */
export function dmarcRecord(domain: string): { name: string; value: string } {
  return { name: `_dmarc.${domain}`, value: "v=DMARC1; p=none; adkim=s; aspf=s;" };
}
