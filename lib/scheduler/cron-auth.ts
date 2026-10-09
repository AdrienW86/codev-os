// Authentification du déclencheur planifié (Vercel Cron envoie « Authorization: Bearer <CRON_SECRET> »).
import { createHash, timingSafeEqual } from "node:crypto";

export type CronAuth = { ok: true } | { ok: false; status: 401 | 503 };

export function checkCronAuthorization(header: string | null, secret: string | undefined): CronAuth {
  if (!secret || secret.trim().length < 16) return { ok: false, status: 503 };
  if (!header || !header.startsWith("Bearer ")) return { ok: false, status: 401 };
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header.slice(7)), digest(secret)) ? { ok: true } : { ok: false, status: 401 };
}
