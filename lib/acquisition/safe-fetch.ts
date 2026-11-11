import "server-only";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BOT_USER_AGENT, WEBSITE_MAX_BYTES, isPrivateAddress, type SafeFetch } from "./website";

const TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;

/**
 * Résolution DNS filtrée : refuse toute adresse privée, locale ou réservée au moment même
 * de la connexion (protège contre le SSRF et le rebinding DNS).
 */
function guardedLookup(hostname: string, options: object, callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = (addresses as LookupAddress[]).filter((a) => !isPrivateAddress(a.address));
    if (!list.length) return callback(Object.assign(new Error("blocked_address"), { code: "EBLOCKED" }), "", 4);
    if ((options as { all?: boolean }).all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

function getOnce(url: URL): Promise<{ status: number; location: string | null; text: string }> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(url, {
      method: "GET", lookup: guardedLookup as never, timeout: TIMEOUT_MS,
      headers: { "User-Agent": BOT_USER_AGENT, Accept: "text/html,text/plain;q=0.9", "Accept-Language": "fr-FR,fr;q=0.9" },
    }, (res) => {
      const status = res.statusCode ?? 0;
      const location = typeof res.headers.location === "string" ? res.headers.location : null;
      if (status >= 300 && status < 400) { res.resume(); return resolve({ status, location, text: "" }); }
      const type = String(res.headers["content-type"] ?? "");
      if (status >= 200 && status < 300 && type && !/text\/|html|xml/.test(type)) { res.destroy(); return resolve({ status: 415, location: null, text: "" }); }
      let size = 0; const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > WEBSITE_MAX_BYTES) { res.destroy(); return; }
        chunks.push(chunk);
      });
      res.on("close", () => resolve({ status, location: null, text: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

/** GET borné (8 s, 600 Ko, 3 redirections, ports 80/443, adresses publiques uniquement). */
export const safeFetchPage: SafeFetch = async (raw) => {
  let url = new URL(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || (url.port && !["80", "443"].includes(url.port))) return null;
    const res = await getOnce(url);
    if (res.location && res.status >= 300 && res.status < 400) { url = new URL(res.location, url); continue; }
    return { ok: res.status >= 200 && res.status < 300, status: res.status, text: res.text, finalUrl: url.toString() };
  }
  return null;
};
