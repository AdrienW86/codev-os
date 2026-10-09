import "server-only";
// PageSpeed Insights (Lighthouse). Fonctionne sans clé (quota réduit) ; PAGESPEED_API_KEY recommandé.
import { providerJson, type FetchLike } from "@/lib/providers/api";
import { checkPublicUrl } from "@/lib/providers/net-policy";
import { ProviderError } from "@/lib/providers/errors";

export type PageSpeedResult = { performance: number | null; lcpMs: number | null; cls: number | null; strategy: "mobile" | "desktop" };

export async function pageSpeed(url: string, options: { strategy?: "mobile" | "desktop"; env?: Record<string, string | undefined>; fetchImpl?: FetchLike } = {}): Promise<PageSpeedResult> {
  const check = checkPublicUrl(url);
  if (!check.ok) throw new ProviderError("pagespeed", "blocked");
  const strategy = options.strategy ?? "mobile";
  const params = new URLSearchParams({ url: check.url.toString(), strategy, category: "performance" });
  const key = (options.env ?? process.env).PAGESPEED_API_KEY;
  if (key) params.set("key", key);
  const data = await providerJson<{ lighthouseResult?: { categories?: { performance?: { score?: unknown } }; audits?: Record<string, { numericValue?: unknown }> } }>(
    "pagespeed", `https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`, { timeoutMs: 45_000, fetchImpl: options.fetchImpl });
  const lighthouse = data.lighthouseResult;
  if (!lighthouse || typeof lighthouse !== "object") throw new ProviderError("pagespeed", "malformed");
  const score = lighthouse.categories?.performance?.score;
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  return { performance: typeof score === "number" ? Math.round(score * 100) : null, lcpMs: num(lighthouse.audits?.["largest-contentful-paint"]?.numericValue), cls: num(lighthouse.audits?.["cumulative-layout-shift"]?.numericValue), strategy };
}
