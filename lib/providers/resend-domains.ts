import "server-only";
// Domaines d'envoi Resend (création, enregistrements DNS, vérification). La gestion des domaines exige une clé Resend
// « Full access » : RESEND_ADMIN_API_KEY si elle est définie (la clé d'envoi RESEND_API_KEY peut alors rester limitée
// à l'envoi), sinon RESEND_API_KEY. Aucun DNS n'est modifié par CODE-V OS : les enregistrements sont à créer chez
// l'hébergeur du domaine du client.
import { providerJson, type FetchLike } from "@/lib/providers/api";
import { ProviderError } from "@/lib/providers/errors";
import { domainStatus, normalizeDomain, readDnsRecords, type DnsRecord, type DomainStatus } from "@/lib/emailing/sender";

type Env = Record<string, string | undefined>;
export type ResendDomain = { id: string; name: string; status: DomainStatus; records: DnsRecord[] };

function apiKey(env: Env): string {
  const key = env.RESEND_ADMIN_API_KEY || env.RESEND_API_KEY;
  if (!key || !/^re_[A-Za-z0-9_-]{8,200}$/.test(key)) throw new ProviderError("resend", "not_configured");
  return key;
}
const domainId = (value: unknown): string => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new ProviderError("resend", "malformed");
  return value;
};
function readDomain(data: unknown, expectedName?: string): ResendDomain {
  const row = (data ?? {}) as { id?: unknown; name?: unknown; status?: unknown; records?: unknown };
  const name = normalizeDomain(row.name);
  if (!name || (expectedName && name !== expectedName)) throw new ProviderError("resend", "malformed");
  return { id: domainId(row.id), name, status: domainStatus(row.status), records: readDnsRecords(row.records) };
}
function call<T>(path: string, env: Env, fetchImpl?: FetchLike, init: { method?: string; body?: unknown } = {}): Promise<T> {
  return providerJson<T>("resend", `https://api.resend.com${path}`, {
    method: init.method ?? "GET", fetchImpl,
    headers: { Authorization: `Bearer ${apiKey(env)}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
}

/** Domaine déjà présent dans le compte Resend (évite un doublon si la création a déjà eu lieu). */
async function findDomain(name: string, env: Env, fetchImpl?: FetchLike): Promise<string | null> {
  const data = await call<{ data?: unknown }>("/domains", env, fetchImpl);
  const list = Array.isArray(data.data) ? data.data as { id?: unknown; name?: unknown }[] : [];
  const match = list.find((item) => normalizeDomain(item.name) === name);
  return match ? domainId(match.id) : null;
}

/** Crée le domaine (région UE) ou retrouve celui qui existe déjà ; renvoie les enregistrements DNS à créer. */
export async function ensureResendDomain(rawName: string, env: Env = process.env, fetchImpl?: FetchLike): Promise<ResendDomain> {
  const name = normalizeDomain(rawName);
  if (!name) throw new ProviderError("resend", "rejected");
  const existing = await findDomain(name, env, fetchImpl);
  if (existing) return getResendDomain(existing, env, fetchImpl);
  return readDomain(await call("/domains", env, fetchImpl, { method: "POST", body: { name, region: "eu-west-1" } }), name);
}

export async function getResendDomain(id: string, env: Env = process.env, fetchImpl?: FetchLike): Promise<ResendDomain> {
  return readDomain(await call(`/domains/${domainId(id)}`, env, fetchImpl));
}

/** Demande à Resend de contrôler les enregistrements DNS (asynchrone : relire le domaine ensuite). */
export async function verifyResendDomain(id: string, env: Env = process.env, fetchImpl?: FetchLike): Promise<void> {
  await call(`/domains/${domainId(id)}/verify`, env, fetchImpl, { method: "POST" });
}
