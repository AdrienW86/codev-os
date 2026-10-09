import "server-only";
// Requêtes HTTP sortantes vers des URL non maîtrisées (sites clients, flux RSS).
// La vérification d'adresse est faite AU MOMENT DE LA CONNEXION (lookup personnalisé) :
// pas de contournement par rebinding DNS. Redirections suivies manuellement et revérifiées.
// Taille de réponse et durée bornées ; aucun cookie ni identifiant transmis.
import { lookup as dnsLookup } from "node:dns";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { checkPublicUrl, isPrivateAddress } from "@/lib/providers/net-policy";
import { ProviderError } from "@/lib/providers/errors";

export type SafeResponse = { url: string; status: number; headers: Record<string, string>; body: string; ms: number };

const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 4);
    const list = (Array.isArray(addresses) ? addresses : [addresses]) as { address: string; family: number }[];
    const safe = list.find((entry) => !isPrivateAddress(entry.address));
    if (!safe || list.some((entry) => isPrivateAddress(entry.address))) return callback(Object.assign(new Error("blocked address"), { code: "EBLOCKED" }), "", 4);
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [safe]);
    callback(null, safe.address, safe.family);
  });
};

function once(target: URL, timeoutMs: number, maxBytes: number, accept: string): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolve, reject) => {
    const request = (target.protocol === "https:" ? httpsRequest : httpRequest)(target, {
      method: "GET", lookup: guardedLookup, timeout: timeoutMs,
      headers: { "User-Agent": "CODE-V-OS/1.0 (+monitoring)", Accept: accept, "Accept-Encoding": "identity" },
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) { request.destroy(); resolve({ status: response.statusCode ?? 0, headers: flatten(response.headers), body: Buffer.concat(chunks).toString("utf8") }); return; }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: flatten(response.headers), body: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
    request.on("error", reject);
    request.end();
  });
}

function flatten(headers: IncomingHttpHeaders) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : String(value ?? "")]));
}

export async function safeGet(raw: string, options: { provider: string; timeoutMs?: number; maxBytes?: number; maxRedirects?: number; accept?: string; allowHttp?: boolean } ): Promise<SafeResponse> {
  const started = Date.now();
  let current = raw;
  for (let hop = 0; hop <= (options.maxRedirects ?? 3); hop++) {
    const check = checkPublicUrl(current, { allowHttp: options.allowHttp });
    if (!check.ok) throw new ProviderError(options.provider, "blocked");
    let response;
    try {
      response = await once(check.url, options.timeoutMs ?? 10_000, options.maxBytes ?? 1_000_000, options.accept ?? "*/*");
    } catch (error) {
      const code = (error as { code?: string }).code;
      throw new ProviderError(options.provider, code === "EBLOCKED" ? "blocked" : code === "ETIMEDOUT" ? "timeout" : "unavailable");
    }
    if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.location) {
      current = new URL(response.headers.location, check.url).toString();
      continue;
    }
    return { url: check.url.toString(), status: response.status, headers: response.headers, body: response.body, ms: Date.now() - started };
  }
  throw new ProviderError(options.provider, "malformed");
}
