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
export interface GoogleAdsReadClient {
  getAccountSummary(customerId: string, managerId?: string): Promise<AdsAccount>;
  getCampaignPerformance(account: AdsAccount, period: AdsPeriod, managerId?: string): Promise<{ campaigns: AdsCampaign[]; totals: AdsMetrics }>;
  /** Lecture seule : inventaire, métriques par campagne, total du compte, leads Local Services (facultatifs). */
  getCampaignDashboard(account: AdsAccount, period: AdsPeriod, previous: AdsPeriod | null, managerId?: string): Promise<CampaignDashboardRaw>;
}
export type GoogleAdsConnection = {
  id: string; client_id: string; provider: string; status: string; external_account_id: string | null;
  metadata: { account_name?: string; currency_code?: string; timezone?: string; manager_customer_id?: string; auth_strategy: "single_user"; connection_version: number };
  last_checked_at: string | null; created_at: string; updated_at: string;
};
export type AdsFormState = { message?: string; ok?: boolean; recommendationId?: string };
