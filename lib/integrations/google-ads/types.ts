export type AdsPeriod = { start: string; end: string; days: number };
export type AdsAccount = { id: string; name: string | null; currency: string; timezone: string };
export type AdsMetrics = {
  impressions: number | null; clicks: number | null; cost: number | null;
  conversions: number | null; conversionValue: number | null; ctr: number | null;
  averageCpc: number | null; costPerConversion: number | null;
};
export type AdsCampaign = {
  id: string; name: string; status: string; channel: string;
  budget: number | null; startDate: string | null; endDate: string | null; metrics: AdsMetrics;
};
export type AdsSignal = { rule: "spend_without_conversions"; campaignId: string; cost: number };
export type AdsAnalysisContext = { account: AdsAccount; period: AdsPeriod; campaigns: AdsCampaign[]; totals: AdsMetrics; anomalies: AdsSignal[] };
export type CampaignInventoryItem = { id: string; name: string; status: string; type: string; subType: string | null; budget: { amount: number | null; shared: boolean | null; period: string | null } };
export type CampaignDashboardRaw = {
  inventory: CampaignInventoryItem[];
  current: Record<string, AdsMetrics>; previous: Record<string, AdsMetrics> | null;
  accountTotals: AdsMetrics; accountPrevious: AdsMetrics | null;
  leads: { available: true; total: number; byType: Record<string, number>; charged: number | null } | { available: false; reason: string } | null;
};
export type ConversionActionDiagnostic = { id: string; name: string; category: string; type: string; status: string; primary: boolean | null; countingType: string; tagSnippets: number | null; allConversions: number | null; lastConversionDate: string | null; lastTagReceivedAt: string | null };
/** Signaux experts (lecture seule) : termes de recherche, part d'impressions, Quality Score, appareils. */
export type AdsSearchTerm = { campaignId: string; term: string; status: string; impressions: number; clicks: number; cost: number; conversions: number };
export type AdsImpressionShare = { campaignId: string; impressionShare: number | null; budgetLost: number | null; rankLost: number | null; topImpressionShare: number | null };
export type AdsKeywordQuality = { campaignId: string; adGroupId: string; criterionId: string; text: string; matchType: string; qualityScore: number | null; adRelevance: string | null; landingPage: string | null; expectedCtr: string | null; cost: number; clicks: number; conversions: number };
export type AdsDeviceRow = { campaignId: string; device: string; cost: number; clicks: number; conversions: number };
export type AdsExpertSignals = {
  /** null : lecture indisponible (droits, quota, type de campagne) — jamais « aucune donnée ». */
  searchTerms: AdsSearchTerm[] | null; impressionShare: AdsImpressionShare[] | null; keywords: AdsKeywordQuality[] | null; devices: AdsDeviceRow[] | null;
};
export interface GoogleAdsReadClient {
  getConversionActionDiagnostics(customerId: string, managerId?: string): Promise<ConversionActionDiagnostic[]>;
  getAccountSummary(customerId: string, managerId?: string): Promise<AdsAccount>;
  getCampaignPerformance(account: AdsAccount, period: AdsPeriod, managerId?: string): Promise<{ campaigns: AdsCampaign[]; totals: AdsMetrics }>;
  /** Lecture seule : inventaire, métriques par campagne, total du compte, leads Local Services (facultatifs). */
  getCampaignDashboard(account: AdsAccount, period: AdsPeriod, previous: AdsPeriod | null, managerId?: string): Promise<CampaignDashboardRaw>;
  /** Lecture seule : métriques du compte jour par jour (graphiques des rapports clients). */
  getDailyMetrics?(account: AdsAccount, period: AdsPeriod, managerId?: string): Promise<(AdsMetrics & { date: string })[]>;
  /** Lecture seule : signaux experts des campagnes du périmètre ; chaque lecture échoue indépendamment (null). */
  getExpertSignals?(account: AdsAccount, period: AdsPeriod, campaignIds: string[], managerId?: string): Promise<AdsExpertSignals>;
}
export type GoogleAdsConnection = {
  id: string; client_id: string; provider: string; status: string; external_account_id: string | null;
  metadata: { account_name?: string; currency_code?: string; timezone?: string; manager_customer_id?: string; auth_strategy: "single_user"; connection_version: number };
  last_checked_at: string | null; created_at: string; updated_at: string;
};
export type AdsFormState = { message?: string; ok?: boolean; recommendationId?: string; runId?: string };
