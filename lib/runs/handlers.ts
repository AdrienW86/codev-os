import "server-only";
// Registre des handlers : un type d'exécution → un module, chargé à la demande.
import type { RunType } from "@/lib/agents/registry";
import type { RunHandler } from "@/lib/runs/types";

export const runHandlers: Record<RunType, () => Promise<RunHandler>> = {
  "report.generate": async () => (await import("@/lib/reports/run")).generateReportsRun,
  "monitoring.check_sites": async () => (await import("@/lib/monitoring/run")).checkSitesRun,
  "seo.analyze": async () => (await import("@/lib/seo/run")).analyzeSeoRun,
  "ads.monitor": async () => (await import("@/lib/ads/run")).monitorAdsRun,
  "news.fetch": async () => (await import("@/lib/news/run")).fetchNewsRun,
};
