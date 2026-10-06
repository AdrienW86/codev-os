import "server-only";

// Only these diagnostic fields reach server logs, never the error object,
// request headers, stack, connection URL or environment itself.
export function safeSupabaseReadError(error: unknown) {
  const fields = error && typeof error === "object"
    ? error as Record<string, unknown> : {};
  const secrets = Object.entries(process.env)
    .filter(([name, value]) => /secret|token|password|db_url|api_key/i.test(name) && value && value.length >= 8)
    .map(([, value]) => value!);
  const sanitize = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    let text = value;
    for (const secret of secrets) text = text.split(secret).join("[REDACTED]");
    return text
      .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, "$1[REDACTED]@")
      .replace(/\b(?:sb_secret_|sb_publishable_|sk_live_|sk_test_)[\w-]+/g, "[REDACTED]")
      .replace(/\beyJ[\w-]*\.[\w-]+\.[\w-]+/g, "[REDACTED]")
      .replace(/\b(Bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
      .replace(/\b(password|token|secret|apikey|api_key)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
      .replace(/[\r\n\u0000-\u001f\u007f]/g, " ")
      .slice(0, 1000);
  };
  // Supabase fetch failures have an empty code; keep their diagnostics too.
  // Unstructured thrown values may contain arbitrary application data.
  const structured = typeof fields.code === "string" && typeof fields.message === "string";
  const code = typeof fields.code === "string" && /^(?:PGRST\d{3}|[A-Z0-9]{5})$/.test(fields.code)
    ? fields.code : null;
  return {
    code,
    message: structured ? sanitize(fields.message) : "Erreur de lecture sans code Supabase.",
    details: structured ? sanitize(fields.details) : null,
    hint: structured ? sanitize(fields.hint) : null,
  };
}
