import type { StatusTone } from "@/components/ui/status-badge";
import type { ReportKind, ReportStatus } from "@/lib/supabase/core.types";

export const reportStatusLabels: Record<ReportStatus, { label: string; tone: StatusTone }> = {
  draft: { label: "Brouillon", tone: "neutral" },
  ready_for_review: { label: "À relire", tone: "amber" },
  approved: { label: "Approuvé", tone: "green" },
  sent: { label: "Envoyé", tone: "blue" },
  archived: { label: "Archivé", tone: "neutral" },
};

export const reportKindLabels: Record<ReportKind, string> = { weekly: "Hebdomadaire", monthly: "Mensuel", google_ads: "Google Ads" };

export const isReportStatus = (value: unknown): value is ReportStatus => typeof value === "string" && value in reportStatusLabels;
export const isReportKind = (value: unknown): value is ReportKind => value === "weekly" || value === "monthly" || value === "google_ads";
/** Seuls les rapports récurrents se génèrent pour « la période close précédente » ; Google Ads se prépare depuis les Campagnes. */
export const isRecurringReportKind = (value: unknown): value is "weekly" | "monthly" => value === "weekly" || value === "monthly";
