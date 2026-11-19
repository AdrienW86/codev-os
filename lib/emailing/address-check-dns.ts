import "server-only";
import { resolveMx } from "node:dns/promises";
import { checkAddresses, type MxLookup } from "./address-check";

// Résolution MX réelle (serveur uniquement), bornée à 4 s par domaine : une réponse lente vaut « unknown ».
const TIMEOUT_MS = 4000;

export const dnsMxLookup: MxLookup = (domain) => Promise.race([
  resolveMx(domain),
  new Promise<never>((_, reject) => setTimeout(() => reject(Object.assign(new Error("dns_timeout"), { code: "ETIMEOUT" })), TIMEOUT_MS)),
]);

export const checkAddressesWithDns = (emails: string[]) => checkAddresses(emails, dnsMxLookup);
