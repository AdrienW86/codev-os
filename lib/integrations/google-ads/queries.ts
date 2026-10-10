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

// --- Tableau de bord des campagnes (lecture seule) ---------------------------------------------
// Inventaire complet, y compris les campagnes supprimées : une campagne retirée peut porter des dépenses
// sur la période ; elle n'est affichée qu'avec le filtre « tous statuts ».
export const campaignInventoryQuery = "SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.advertising_channel_sub_type, campaign_budget.amount_micros, campaign_budget.explicitly_shared, campaign_budget.period FROM campaign";
/** Métriques agrégées par campagne sur la période (une ligne par campagne ayant de l'activité). */
export function campaignMetricsQuery(period: AdsPeriod) {
  return `SELECT campaign.id, ${metrics} FROM campaign WHERE ${dateClause(period)}`;
}
/**
 * Leads Local Services (ressource local_services_lead, lecture seule). Seuls le type, le statut, la
 * facturation et la date sont lus : jamais les coordonnées (contact_details) ni les conversations.
 */
export function localServicesLeadsQuery(period: AdsPeriod) {
  validatePeriod(period);
  return `SELECT local_services_lead.lead_type, local_services_lead.lead_status, local_services_lead.lead_charged, local_services_lead.creation_date_time FROM local_services_lead WHERE local_services_lead.creation_date_time >= '${period.start} 00:00:00' AND local_services_lead.creation_date_time <= '${period.end} 23:59:59'`;
}
