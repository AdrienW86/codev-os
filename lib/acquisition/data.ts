import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { placesExpiryThreshold } from "./places";
import type { AcquisitionDiscoveryRun, AcquisitionMessage, AcquisitionProspect, AcquisitionSender, AcquisitionTemplate, AcquisitionWorkspace } from "./model";

export type AcquisitionSnapshot = {
  workspaces: AcquisitionWorkspace[];
  prospects: AcquisitionProspect[];
  messages: AcquisitionMessage[];
  senders: AcquisitionSender[];
  templates: AcquisitionTemplate[];
  discoveryRuns: AcquisitionDiscoveryRun[];
  schemaReady: boolean;
  /** Migration 20261203000000 (Agent Prospection) appliquée. */
  prescribersReady: boolean;
  /** Migration 20261204000000 (multi-sources) appliquée. */
  multisourceReady: boolean;
  unavailableReason?: string;
};

const BASE_PROSPECT_COLUMNS = "id,workspace_id,company_name,website,category,stage,score,source_url,source_checked_at,explanation,created_at";
export const PRESCRIBER_PROSPECT_COLUMNS = BASE_PROSPECT_COLUMNS +
  ",data_source,siren,naf_code,segment,address,postal_code,city,distance_km,employee_range,is_sole_proprietor,places_website,places_phone,places_enriched_at";

export const MULTISOURCE_PROSPECT_COLUMNS = PRESCRIBER_PROSPECT_COLUMNS +
  ",osm_website,osm_phone,bodacc_created_on,bodacc_url,contact_email,contact_email_source,website_status,legal_id_confirmed";
const RUN_COLUMNS = "id,workspace_id,trade_profile,place,radius_km,status,found_count,inserted_count,error,created_at";

/** Masque les données Google Places au-delà de la durée de conservation autorisée. */
export function withoutExpiredPlacesData(prospect: AcquisitionProspect, threshold = placesExpiryThreshold()): AcquisitionProspect {
  if (!prospect.places_enriched_at || prospect.places_enriched_at >= threshold) return prospect;
  return { ...prospect, places_website: null, places_phone: null };
}

/** Colonnes de l'Agent Prospection : absentes tant que la migration n'est pas appliquée. */
async function loadPrescriberData(db: SupabaseClient): Promise<{ ready: boolean; multisource: boolean; prospects: AcquisitionProspect[]; runs: AcquisitionDiscoveryRun[] }> {
  const query = (columns: string, runColumns: string) => Promise.all([
    db.from("acquisition_prospects").select(columns).order("score", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(500),
    db.from("acquisition_discovery_runs").select(runColumns).order("created_at", { ascending: false }).limit(20),
  ]);
  // Migration multi-sources (20261204000000) d'abord, sinon colonnes Prescripteurs seules.
  let multisource = true;
  let [p, r] = await query(MULTISOURCE_PROSPECT_COLUMNS, RUN_COLUMNS + ",mode,phase,progress");
  if (p.error || r.error) { multisource = false; [p, r] = await query(PRESCRIBER_PROSPECT_COLUMNS, RUN_COLUMNS); }
  if (p.error || r.error) return { ready: false, multisource: false, prospects: [], runs: [] };
  const threshold = placesExpiryThreshold();
  return {
    ready: true, multisource,
    prospects: ((p.data ?? []) as unknown as AcquisitionProspect[]).map((item) => withoutExpiredPlacesData(item, threshold)),
    runs: (r.data ?? []) as unknown as AcquisitionDiscoveryRun[],
  };
}

/** Read-only, admin-bound dashboard. Never return credentials or tokens to a browser. */
export async function getAcquisitionSnapshot(): Promise<AcquisitionSnapshot> {
  const empty: AcquisitionSnapshot = { workspaces: [], prospects: [], messages: [], senders: [], templates: [], discoveryRuns: [], schemaReady: false, prescribersReady: false, multisourceReady: false };
  try {
    // Database types will be generated after the isolated migration is validated and deployed.
    const db = getSupabaseServerClient() as unknown as SupabaseClient;
    const [w,p,m,s,t] = await Promise.all([
      db.from("acquisition_workspaces").select("id,client_id,label,is_internal,discovery_enabled,sending_enabled,emergency_stop,daily_send_limit,timezone").order("created_at", {ascending:false}).limit(100),
      db.from("acquisition_prospects").select(BASE_PROSPECT_COLUMNS).order("created_at", {ascending:false}).limit(150),
      db.from("acquisition_messages").select("id,workspace_id,prospect_id,recipient_email,subject,body_text,state,created_at").order("created_at", {ascending:false}).limit(100),
      db.from("acquisition_senders").select("id,workspace_id,address,provider,status,daily_limit").limit(100),
      db.from("acquisition_templates").select("id,workspace_id,category,name,subject_template,body_template,enabled").limit(100),
    ]);
    const bad = [w,p,m,s,t].find((v)=>v.error);
    if (bad?.error) return {...empty, unavailableReason: "Schéma Acquisition non prêt ou accès aux données indisponible."};
    const prescribers = await loadPrescriberData(db);
    return { schemaReady: true, prescribersReady: prescribers.ready, multisourceReady: prescribers.multisource, discoveryRuns: prescribers.runs,
      workspaces: (w.data ?? []) as AcquisitionWorkspace[],
      prospects: prescribers.ready ? prescribers.prospects : (p.data ?? []) as AcquisitionProspect[],
      messages: (m.data ?? []) as AcquisitionMessage[],
      senders: (s.data ?? []) as AcquisitionSender[],
      templates: (t.data ?? []) as AcquisitionTemplate[],
    };
  } catch {
    return {...empty, unavailableReason:"Connexion à la base indisponible. Aucun envoi n'a été tenté."};
  }
}
