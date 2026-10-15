/** Only absent Postgres/PostgREST tables justify the legacy SEO fallback.
 * Permission, connection and query failures must remain visible rather than being hidden.
 */
export function missingSeoSchema(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "42P01" || code === "PGRST205";
}
