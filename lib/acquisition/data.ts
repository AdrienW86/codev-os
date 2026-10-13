import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { AcquisitionMessage, AcquisitionProspect, AcquisitionSender, AcquisitionTemplate, AcquisitionWorkspace } from "./model";

export type AcquisitionSnapshot = {
  workspaces: AcquisitionWorkspace[];
  prospects: AcquisitionProspect[];
  messages: AcquisitionMessage[];
  senders: AcquisitionSender[];
  templates: AcquisitionTemplate[];
  schemaReady: boolean;
  unavailableReason?: string;
};

/** Read-only, admin-bound dashboard. Never return credentials or tokens to a browser. */
export async function getAcquisitionSnapshot(): Promise<AcquisitionSnapshot> {
  const empty: AcquisitionSnapshot = { workspaces: [], prospects: [], messages: [], senders: [], templates: [], schemaReady: false };
  try {
    // Database types will be generated after the isolated migration is validated and deployed.
    const db = getSupabaseServerClient() as unknown as SupabaseClient;
    const [w,p,m,s,t] = await Promise.all([
      db.from("acquisition_workspaces").select("id,client_id,label,is_internal,discovery_enabled,sending_enabled,emergency_stop,daily_send_limit,timezone").order("created_at", {ascending:false}).limit(100),
      db.from("acquisition_prospects").select("id,workspace_id,company_name,website,category,stage,score,source_url,source_checked_at,explanation,created_at").order("created_at", {ascending:false}).limit(150),
      db.from("acquisition_messages").select("id,workspace_id,prospect_id,recipient_email,subject,body_text,state,created_at").order("created_at", {ascending:false}).limit(100),
      db.from("acquisition_senders").select("id,workspace_id,address,provider,status,daily_limit").limit(100),
      db.from("acquisition_templates").select("id,workspace_id,category,name,subject_template,body_template,enabled").limit(100),
    ]);
    const bad = [w,p,m,s,t].find((v)=>v.error);
    if (bad?.error) return {...empty, unavailableReason: "Schéma Acquisition non prêt ou accès aux données indisponible."};
    return { schemaReady: true,
      workspaces: (w.data ?? []) as AcquisitionWorkspace[],
      prospects: (p.data ?? []) as AcquisitionProspect[],
      messages: (m.data ?? []) as AcquisitionMessage[],
      senders: (s.data ?? []) as AcquisitionSender[],
      templates: (t.data ?? []) as AcquisitionTemplate[],
    };
  } catch {
    return {...empty, unavailableReason:"Connexion à la base indisponible. Aucun envoi n'a été tenté."};
  }
}
