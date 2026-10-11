import "server-only";
// Coffre du jeton de rafraîchissement Search Console : AES-256-GCM, IV aléatoire de 96 bits par secret, référence et
// fournisseur liés comme données authentifiées (un chiffré déplacé ou relu pour un autre usage échoue). Même trousseau
// de clés que les connexions de publication, avec un domaine distinct : les jetons Meta / Business Profile ne sont
// ni lus ni modifiés. La base (integration_credential_secrets, rôle serveur uniquement) ne voit jamais de clair.
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import type { CredentialKeyring } from "@/lib/integrations/publications-oauth/config";

export type StoredGrant = { refreshToken: string; scopes: string[] };
export type SecretRecord = { reference: string; provider: "search-console"; key_id: string; iv: Uint8Array; ciphertext: Uint8Array; auth_tag: Uint8Array };
export interface SecretTable {
  insert(row: SecretRecord): Promise<void>;
  get(reference: string): Promise<SecretRecord | null>;
  remove(reference: string): Promise<void>;
}
export class SearchConsoleVaultError extends Error {
  constructor(readonly kind: "invalid_reference" | "not_found" | "invalid_secret" | "corrupted" | "unconfigured" | "unavailable") { super(`Search Console vault: ${kind}`); }
}

const REFERENCE = /^vault:connection\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isSecretReference = (value: unknown): value is string => typeof value === "string" && REFERENCE.test(value);
const aad = (reference: string) => Buffer.from(`codev:integration-credential:v1:search-console:${reference}`, "utf8");
const opaque = (value: unknown): value is string => typeof value === "string" && value.length >= 8 && value.length <= 4096 && /^[\x21-\x7e]+$/.test(value);
const validGrant = (value: unknown): value is StoredGrant => Boolean(value && typeof value === "object" && opaque((value as StoredGrant).refreshToken)
  && Array.isArray((value as StoredGrant).scopes) && (value as StoredGrant).scopes.length <= 20 && (value as StoredGrant).scopes.every((scope) => typeof scope === "string" && scope.length <= 300));

export function createSearchConsoleVault(table: SecretTable, keyring: CredentialKeyring, ids: () => string = randomUUID) {
  const keyFor = (id: string) => id === keyring.current.id ? keyring.current.key : keyring.previous && id === keyring.previous.id ? keyring.previous.key : null;
  return {
    async store(grant: StoredGrant): Promise<string> {
      if (!validGrant(grant)) throw new SearchConsoleVaultError("invalid_secret");
      const reference = `vault:connection/${ids()}`;
      if (!isSecretReference(reference)) throw new SearchConsoleVaultError("invalid_reference");
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", keyring.current.key, iv);
      cipher.setAAD(aad(reference));
      const plaintext = Buffer.from(JSON.stringify({ refreshToken: grant.refreshToken, scopes: grant.scopes }), "utf8");
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      plaintext.fill(0);
      try { await table.insert({ reference, provider: "search-console", key_id: keyring.current.id, iv, ciphertext, auth_tag: cipher.getAuthTag() }); }
      catch { throw new SearchConsoleVaultError("unavailable"); }
      return reference;
    },
    async read(reference: string): Promise<StoredGrant> {
      if (!isSecretReference(reference)) throw new SearchConsoleVaultError("invalid_reference");
      let row: SecretRecord | null;
      try { row = await table.get(reference); } catch { throw new SearchConsoleVaultError("unavailable"); }
      if (!row || row.provider !== "search-console") throw new SearchConsoleVaultError("not_found");
      const key = keyFor(row.key_id);
      if (!key) throw new SearchConsoleVaultError("unconfigured");
      let value: unknown;
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(row.iv));
        decipher.setAAD(aad(reference));
        decipher.setAuthTag(Buffer.from(row.auth_tag));
        const plain = Buffer.concat([decipher.update(Buffer.from(row.ciphertext)), decipher.final()]);
        value = JSON.parse(plain.toString("utf8"));
        plain.fill(0);
      } catch { throw new SearchConsoleVaultError("corrupted"); }
      if (!validGrant(value)) throw new SearchConsoleVaultError("corrupted");
      return value;
    },
    async remove(reference: string) {
      if (!isSecretReference(reference)) throw new SearchConsoleVaultError("invalid_reference");
      try { await table.remove(reference); } catch { throw new SearchConsoleVaultError("unavailable"); }
    },
  };
}
export type SearchConsoleVault = ReturnType<typeof createSearchConsoleVault>;

// bytea via littéraux hexadécimaux PostgreSQL ('\x…'), comme le coffre des publications.
const hex = (bytes: Uint8Array) => "\\x" + Buffer.from(bytes).toString("hex");
const bytes = (value: unknown): Uint8Array => { if (typeof value !== "string" || !/^\\x([0-9a-f]{2})*$/.test(value)) throw new Error("bytea"); return Buffer.from(value.slice(2), "hex"); };
type Db = { from(table: "integration_credential_secrets"): unknown };
export function supabaseSecretTable(db: Db): SecretTable {
  // Typage volontairement minimal : seules les trois opérations ci-dessous sont utilisées.
  const table = () => (db as { from(name: string): any }).from("integration_credential_secrets"); // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    async insert(row) { const { error } = await table().insert({ reference: row.reference, provider: row.provider, key_id: row.key_id, iv: hex(row.iv), ciphertext: hex(row.ciphertext), auth_tag: hex(row.auth_tag) }); if (error) throw new Error("store"); },
    async get(reference) {
      const { data, error } = await table().select("reference,provider,key_id,iv,ciphertext,auth_tag").eq("reference", reference).maybeSingle();
      if (error) throw new Error("store");
      if (!data) return null;
      if (data.provider !== "search-console") throw new Error("store");
      return { reference: String(data.reference), provider: "search-console", key_id: String(data.key_id), iv: bytes(data.iv), ciphertext: bytes(data.ciphertext), auth_tag: bytes(data.auth_tag) };
    },
    async remove(reference) { const { error } = await table().delete().eq("reference", reference); if (error) throw new Error("store"); },
  };
}
