"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/require-admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ACQUISITION_CATEGORIES } from "@/lib/acquisition/model";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const categories = new Set<string>(ACQUISITION_CATEGORIES.map(c => c.id));
const text = (data: FormData, name: string, max: number) => {
  const v = data.get(name);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
};
function httpUrl(value: string): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password || u.hostname === "localhost" || !u.hostname.includes(".")) return null;
    return u.toString();
  } catch { return null; }
}
function deny(reason: string): never { redirect(`/acquisition?notice=${encodeURIComponent(reason)}`); }
function db(): SupabaseClient { return getSupabaseServerClient() as unknown as SupabaseClient; }

export async function createInternalAcquisitionWorkspace(data: FormData) {
  await requireAdmin();
  if (text(data, "confirmation", 30) !== "CODE-V") deny("validation");
  const client = db();
  const { data: existing, error: readError } = await client.from("acquisition_workspaces").select("id").eq("is_internal",true).limit(1);
  if (readError) deny("storage");
  if (existing?.length) deny("already_exists");
  const { error } = await client.from("acquisition_workspaces").insert({
    label:"CODE-V",is_internal:true,emergency_stop:true,discovery_enabled:false,sending_enabled:false,daily_send_limit:0,timezone:"Europe/Paris",
  });
  if (error) deny("storage");
  revalidatePath("/acquisition");
  redirect("/acquisition?notice=workspace_created");
}

export async function createAcquisitionProspect(data: FormData) {
  await requireAdmin();
  const workspaceId = text(data,"workspace_id",36);
  const name = text(data,"company_name",180);
  const category = text(data,"category",48);
  const source = httpUrl(text(data,"source_url",2048));
  const websiteRaw = text(data,"website",2048);
  const website = websiteRaw ? httpUrl(websiteRaw) : null;
  const explanation = text(data,"explanation",2000);
  if (!uuid.test(workspaceId) || name.length < 2 || !categories.has(category) || !source || (websiteRaw && !website) || explanation.length < 15) deny("invalid_prospect");
  const client = db();
  const { data: workspace, error: accessError } = await client.from("acquisition_workspaces").select("id").eq("id",workspaceId).maybeSingle();
  if (accessError || !workspace) deny("workspace_missing");
  // Manual discovery; nothing is automatically qualified or approved.
  const { error } = await client.from("acquisition_prospects").insert({
    workspace_id:workspaceId,company_name:name,category,website,
    domain_normalized: website ? new URL(website).hostname.toLowerCase().replace(/^www\./,"") : null,
    source_url:source,source_checked_at:new Date().toISOString(),explanation,stage:"discovered",
  });
  if (error) deny("storage");
  revalidatePath("/acquisition");
  redirect("/acquisition?notice=prospect_created");
}

export async function createAcquisitionTemplate(data: FormData) {
  await requireAdmin();
  const workspaceId=text(data,"workspace_id",36);
  const category=text(data,"category",48);
  const name=text(data,"name",100);
  const subject=text(data,"subject",240);
  const body=text(data,"body",8000);
  if (!uuid.test(workspaceId) || !categories.has(category) || name.length<2 || subject.length<3 || body.length<20) deny("invalid_template");
  // Templates remain disabled and can never directly trigger a send.
  const {error}=await db().from("acquisition_templates").insert({
    workspace_id:workspaceId,category,name,subject_template:subject,body_template:body,enabled:false,
  });
  if(error) deny("storage");
  revalidatePath("/acquisition");
  redirect("/acquisition?notice=template_created");
}
