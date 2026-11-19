import { normalizeEmail } from "./policy";

// Vérification d'une adresse avant envoi (fonctions pures ; la résolution DNS est injectée).
// Objectif délivrabilité : garder un taux de rebond très bas (au-delà de 2 %, les messageries freinent le domaine
// d'envoi). Contrôles sans service payant ni connexion SMTP au serveur du destinataire (aucune sonde intrusive) :
// syntaxe, domaine jetable, faute de frappe connue, serveur de messagerie (MX) publié et non nul (RFC 7505).

export type AddressCheckStatus = "valid" | "invalid_syntax" | "disposable" | "typo" | "no_mx" | "unknown";
export type AddressCheck = { status: AddressCheckStatus; detail: string | null };
export type MxLookup = (domain: string) => Promise<{ exchange: string; priority: number }[]>;

export const ADDRESS_CHECK_LABELS: Record<AddressCheckStatus, string> = {
  valid: "Adresse vérifiée", invalid_syntax: "Adresse mal formée", disposable: "Messagerie jetable", typo: "Faute de frappe probable",
  no_mx: "Le domaine ne reçoit pas d'e-mails", unknown: "Vérification impossible pour l'instant",
};

/** Une vérification reste valable 30 jours ; au-delà, elle est refaite avant l'envoi. */
export const ADDRESS_CHECK_TTL_DAYS = 30;

const DISPOSABLE = new Set(["mailinator.com", "yopmail.com", "yopmail.fr", "yopmail.net", "guerrillamail.com", "guerrillamail.net", "sharklasers.com", "10minutemail.com", "10minutemail.net",
  "temp-mail.org", "tempmail.com", "tempmail.net", "trashmail.com", "trashmail.fr", "jetable.org", "jetable.com", "getnada.com", "maildrop.cc", "dispostable.com", "throwawaymail.com",
  "fakeinbox.com", "mailnesia.com", "mohmal.com", "emailondeck.com", "spamgourmet.com", "mintemail.com", "mytemp.email", "tempr.email", "discard.email", "moakt.com"]);

const TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com", "gmal.com": "gmail.com", "gmail.fr": "gmail.com", "gamil.com": "gmail.com", "gmail.co": "gmail.com", "gmaill.com": "gmail.com",
  "hotmial.com": "hotmail.com", "hotmail.fe": "hotmail.fr", "hotmal.fr": "hotmail.fr", "hotmial.fr": "hotmail.fr", "outlok.fr": "outlook.fr", "outlook.fe": "outlook.fr",
  "orange.f": "orange.fr", "oragne.fr": "orange.fr", "wanadoo.f": "wanadoo.fr", "wanadoo.com": "wanadoo.fr", "free.f": "free.fr", "laposte.fe": "laposte.net", "sfr.f": "sfr.fr",
  "yahoo.f": "yahoo.fr", "yaho.fr": "yahoo.fr", "yahooo.fr": "yahoo.fr",
};

/** Contrôles sans réseau : syntaxe, domaine jetable, faute de frappe connue. null = à vérifier côté DNS. */
export function precheckAddress(raw: unknown): AddressCheck | null {
  const email = normalizeEmail(raw);
  if (!email) return { status: "invalid_syntax", detail: null };
  const [local, domain] = email.split("@");
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..") || domain.includes("..") || domain.split(".").some((label) => !label || label.startsWith("-") || label.endsWith("-")))
    return { status: "invalid_syntax", detail: null };
  if (DISPOSABLE.has(domain)) return { status: "disposable", detail: domain };
  if (Object.hasOwn(TYPOS, domain)) return { status: "typo", detail: `${local}@${TYPOS[domain]} ?` };
  return null;
}

/** Lecture d'une réponse MX : au moins un serveur réel (le MX nul « . » signifie « n'accepte aucun e-mail »). */
export function mxAccepts(records: { exchange: string; priority: number }[]): boolean {
  return records.some((record) => typeof record?.exchange === "string" && record.exchange.replace(/\.$/, "").trim().length > 0);
}

const DNS_MISSING = new Set(["ENOTFOUND", "ENODATA", "ENONAME", "NXDOMAIN"]);

/** Vérifie une adresse : contrôles locaux puis MX du domaine. Une panne DNS donne « unknown » (jamais « valid »). */
export async function checkAddress(raw: unknown, lookup: MxLookup): Promise<AddressCheck> {
  const pre = precheckAddress(raw);
  if (pre) return pre;
  const domain = normalizeEmail(raw)!.split("@")[1];
  try {
    return mxAccepts(await lookup(domain)) ? { status: "valid", detail: null } : { status: "no_mx", detail: domain };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    return typeof code === "string" && DNS_MISSING.has(code) ? { status: "no_mx", detail: domain } : { status: "unknown", detail: null };
  }
}

/** Vérifie une liste d'adresses, une seule résolution par domaine, quelques requêtes en parallèle. */
export async function checkAddresses(emails: string[], lookup: MxLookup, concurrency = 8): Promise<Map<string, AddressCheck>> {
  const byDomain = new Map<string, Promise<{ exchange: string; priority: number }[]>>();
  const cached: MxLookup = (domain) => { if (!byDomain.has(domain)) byDomain.set(domain, lookup(domain)); return byDomain.get(domain)!; };
  const results = new Map<string, AddressCheck>();
  const queue = [...new Set(emails)];
  const worker = async () => { for (let email = queue.shift(); email !== undefined; email = queue.shift()) results.set(email, await checkAddress(email, cached)); };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, worker));
  return results;
}

/** Une adresse peut être approuvée puis envoyée si elle a été vérifiée valide il y a moins de 30 jours. */
export function addressCheckFresh(status: string | null | undefined, checkedAt: string | null | undefined, now = new Date()): boolean {
  if (status !== "valid" || !checkedAt) return false;
  const at = Date.parse(checkedAt);
  return Number.isFinite(at) && at <= now.getTime() + 60_000 && now.getTime() - at < ADDRESS_CHECK_TTL_DAYS * 86_400_000;
}

/** Adresse jugée non distribuable (hors panne DNS « unknown ») il y a moins de 30 jours : inutile de la revérifier. */
export function recentlyUndeliverable(status: string | null | undefined, checkedAt: string | null | undefined, now = new Date()): boolean {
  if (!status || status === "valid" || status === "unknown" || !checkedAt) return false;
  const at = Date.parse(checkedAt);
  return Number.isFinite(at) && now.getTime() - at < ADDRESS_CHECK_TTL_DAYS * 86_400_000;
}
