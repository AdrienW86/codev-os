import type { AdsPeriod } from "./types";
import { validatePeriod } from "./validation";

export const accountSummaryQuery = "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1";
export const campaignsQuery = "SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros, campaign.start_date_time, campaign.end_date_time FROM campaign WHERE campaign.status != 'REMOVED'";
const metrics = "metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.ctr, metrics.average_cpc";
function dateClause(period: AdsPeriod) {
  validatePeriod(period);
  return `segments.date BETWEEN '${period.start}' AND '${period.end}'`;
}
export function campaignPerformanceQuery(period: AdsPeriod) {
  return `SELECT campaign.id, ${metrics} FROM campaign WHERE campaign.status != 'REMOVED' AND ${dateClause(period)}`;
}
export function accountPerformanceQuery(period: AdsPeriod) {
  return `SELECT ${metrics} FROM customer WHERE ${dateClause(period)}`;
}
