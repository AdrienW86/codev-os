import "server-only";
// Lectures réseau de la santé technique des sites (lot 5) : certificat TLS (port 443), DNS, registre du domaine (RDAP),
// robots.txt, sitemap et pages du sitemap. Lecture seule, bornée en temps et en taille ; adresses privées refusées.
import { connect } from "node:tls";
import { promises as dns } from "node:dns";
import { isPrivateAddress } from "@/lib/providers/net-policy";
import { safeGet } from "@/lib/providers/safe-http";
import type { CertificateResult, DnsResult } from "@/lib/site-health/model";

const TIMEOUT = 8_000;

/** Certificat présenté par le site (SNI = hôte), sans le valider : on veut lire sa date même s'il est expiré. */
export async function readCertificate(host: string): Promise<CertificateResult> {
  const addresses = await dns.lookup(host, { all: true }).catch(() => []);
  const target = addresses.find((entry) => !isPrivateAddress(entry.address));
  if (!target || addresses.some((entry) => isPrivateAddress(entry.address))) return null;
  return new Promise((resolve) => {
    const socket = connect({ host: target.address, port: 443, servername: host, rejectUnauthorized: false, timeout: TIMEOUT }, () => {
      const cert = socket.getPeerCertificate();
      const authorizationError = socket.authorizationError ? String(socket.authorizationError) : null;
      socket.end();
      if (!cert || !cert.valid_to) return resolve(null);
      const validTo = Number.isFinite(Date.parse(cert.valid_to)) ? new Date(Date.parse(cert.valid_to)).toISOString() : null;
      const issuer = typeof cert.issuer?.O === "string" ? cert.issuer.O.slice(0, 80) : typeof cert.issuer?.CN === "string" ? cert.issuer.CN.slice(0, 80) : null;
      resolve({ validTo, issuer, hostnameMatch: authorizationError === "ERR_TLS_CERT_ALTNAME_INVALID" ? false : true });
    });
    socket.on("timeout", () => { socket.destroy(); resolve(null); });
    socket.on("error", () => resolve(null));
  });
}

export async function readDns(host: string): Promise<DnsResult> {
  const resolves = async (name: string) => {
    const [v4, v6] = await Promise.all([dns.resolve4(name).catch((e: { code?: string }) => (e.code === "ENODATA" || e.code === "ENOTFOUND" ? [] : null)), dns.resolve6(name).catch(() => [])]);
    if (v4 === null) return null;
    return v4.length > 0 || v6.length > 0;
  };
  const bare = host.replace(/^www\./, "");
  const [apex, www, mx] = await Promise.all([resolves(host), host.startsWith("www.") ? Promise.resolve(true) : resolves(`www.${host}`), dns.resolveMx(bare).then((rows) => rows.length > 0).catch((e: { code?: string }) => (e.code === "ENODATA" || e.code === "ENOTFOUND" ? false : null))]);
  return { apex, www, mx };
}

/** Date d'expiration du domaine via RDAP (rdap.org redirige vers le registre). undefined = non vérifiable. */
export async function readRdap(domain: string): Promise<unknown | undefined> {
  try {
    const response = await safeGet(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { provider: "rdap", timeoutMs: TIMEOUT, maxBytes: 300_000, accept: "application/rdap+json, application/json" });
    if (response.status !== 200) return undefined;
    return JSON.parse(response.body);
  } catch { return undefined; }
}

/** Lecture bornée d'une page du site (robots.txt, sitemap, page du sitemap). status null = injoignable. */
export async function fetchSitePage(url: string, maxBytes = 2_000_000): Promise<{ status: number | null; finalUrl: string | null; body: string }> {
  try {
    const response = await safeGet(url, { provider: "http", allowHttp: true, timeoutMs: TIMEOUT, maxBytes, accept: "text/html,application/xml,text/xml,text/plain,*/*" });
    return { status: response.status, finalUrl: response.url, body: response.body };
  } catch { return { status: null, finalUrl: null, body: "" }; }
}
