// Rapport Google Ads (pur, déterministe, sans IA) : instantané des campagnes d'un périmètre figé
// (dates exactes + campagnes). Le contenu suit le format ReportContent des rapports existants.
import type { CampaignRow, LocalServicesLeads } from "@/lib/integrations/google-ads/dashboard";
import { sumCampaigns, typeLabel, statusLabels, groupByType } from "@/lib/integrations/google-ads/dashboard";
import { describeDates } from "@/lib/integrations/google-ads/periods";
import type { StoredAdsScope } from "@/lib/integrations/google-ads/scope";
import type { AdsMetrics } from "@/lib/integrations/google-ads/types";
import type { ReportContent, ReportSection } from "./build";

export type GoogleAdsReportInput = {
  clientName: string; accountName: string; scope: StoredAdsScope;
  /** Campagnes du périmètre uniquement (déjà filtrées). */
  rows: CampaignRow[];
  leads: LocalServicesLeads | null;
  includesToday: boolean;
};

const unavailable = "indisponible";

export function buildGoogleAdsReport(input: GoogleAdsReportInput): { title: string; internal: ReportContent; client: ReportContent } {
  const { scope, rows } = input;
  const money = (value: number | null) => value === null ? unavailable : new Intl.NumberFormat("fr-FR", { style: "currency", currency: scope.currency }).format(value);
  const count = (value: number | null) => value === null ? unavailable : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value);
  const percent = (value: number | null) => value === null ? unavailable : `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value * 100)} %`;
  const metricLines = (metrics: AdsMetrics) => [
    `Dépenses : ${money(metrics.cost)}`, `Impressions : ${count(metrics.impressions)}`, `Clics : ${count(metrics.clicks)}`, `CTR : ${percent(metrics.ctr)}`,
    `CPC moyen : ${money(metrics.averageCpc)}`, `Conversions : ${count(metrics.conversions)}`, `Coût par conversion : ${money(metrics.costPerConversion)}`,
    `Valeur de conversion (déclarée dans Google Ads, distincte du chiffre d’affaires) : ${money(metrics.conversionValue)}`,
  ];
  const period = { start: scope.start, end: scope.end, days: scope.days };
  const dates = describeDates(period);
  const totals = sumCampaigns(rows);
  const groups = groupByType(rows);
  const typesText = groups.map((group) => `${group.rows.length} ${group.label}`).join(", ");
  const hasLocalServices = rows.some((row) => row.localServices);

  const leadsLines = !hasLocalServices ? [] : !input.leads ? ["Leads Local Services : indisponibles."]
    : input.leads.available
      ? [`Leads Local Services reçus : ${input.leads.total} (compte entier : la ressource des leads n’est pas rattachée à une campagne).`,
        ...Object.entries(input.leads.byType).map(([type, total]) => `• ${type} : ${total}`),
        `Leads facturés : ${input.leads.charged === null ? unavailable : input.leads.charged}`]
      : [`Leads Local Services : indisponibles (${input.leads.reason}).`];

  const notes = [
    "Les conversions peuvent être attribuées avec retard : une période récente peut encore évoluer.",
    input.includesToday ? "La période inclut aujourd’hui : données partielles au moment de la génération." : null,
    totals.incomplete.length ? `Totaux partiels : certaines campagnes ne fournissent pas ${totals.incomplete.join(", ")} (Local Services notamment).` : null,
    hasLocalServices ? "Local Services : clics, conversions et leads sont des mesures distinctes ; aucune n’est déduite d’une autre." : null,
  ].filter((line): line is string => Boolean(line));

  const scopeLines = [
    `Période : ${dates} (${scope.days} jour${scope.days > 1 ? "s" : ""}, fuseau du compte ${scope.timezone})`,
    `Compte Google Ads : ${input.accountName} (${scope.accountId})`,
    `${rows.length} campagne${rows.length > 1 ? "s" : ""} : ${typesText}`,
  ];

  const campaignLine = (row: CampaignRow) => `${row.name} (ID ${row.id}) — ${typeLabel(row.type)}, ${statusLabels[row.status] ?? row.status} — ${row.hasActivity ? `${money(row.metrics.cost)}, ${count(row.metrics.clicks)} clics, ${count(row.metrics.conversions)} conversions` : row.localServices ? "métriques de campagne non renvoyées par l’API (indisponibles)" : "aucune activité sur la période"}`;

  const internalSections: ReportSection[] = [
    { title: "Périmètre (figé)", lines: scopeLines },
    { title: "Totaux du périmètre", lines: metricLines(totals.metrics) },
    ...groups.map((group) => ({ title: `Campagnes ${group.label}`, lines: group.rows.map(campaignLine) })),
    { title: "Local Services — leads", lines: leadsLines },
    { title: "Notes de lecture", lines: [...notes, "Rapport déterministe (sans IA), lu en lecture seule : aucune modification Google Ads."] },
  ].filter((section) => section.lines.length);

  const clientSections: ReportSection[] = [
    { title: "Périmètre", lines: [`Période : ${dates}`, ...rows.map((row) => `${row.name} (${typeLabel(row.type)})`)] },
    { title: "Résultats", lines: metricLines(totals.metrics) },
    ...(groups.length > 1 ? [{ title: "Par type de campagne", lines: groups.map((group) => { const sum = sumCampaigns(group.rows).metrics; return `${group.label} : ${money(sum.cost)}, ${count(sum.clicks)} clics, ${count(sum.conversions)} conversions`; }) }] : []),
    { title: "Local Services", lines: leadsLines },
    { title: "À noter", lines: notes },
  ].filter((section) => section.lines.length);

  const summary = `${input.clientName} — Google Ads ${dates} : ${rows.length} campagne${rows.length > 1 ? "s" : ""} (${typesText}), ${money(totals.metrics.cost)} dépensés, ${count(totals.metrics.clicks)} clics, ${count(totals.metrics.conversions)} conversions.`;
  // Local Services sans métriques renvoyées : données indisponibles, pas « aucune activité ».
  const empty = !rows.some((row) => row.hasActivity || row.localServices);
  return {
    title: `Rapport Google Ads — ${input.clientName} — ${dates}`.slice(0, 200),
    internal: { summary, highlights: [], sections: internalSections, empty },
    client: { summary: empty ? `Aucune activité Google Ads sur ce périmètre ${dates}.` : summary, highlights: [], sections: clientSections, empty },
  };
}
