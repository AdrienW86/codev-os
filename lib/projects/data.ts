import "server-only";
import { requireAdmin } from "@/lib/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit-logs";
import type { CreateProjectResult, DeleteProjectResult, ProjectRecord } from "./types";
import { validateProjectForm } from "./validation";
import {readAllRows} from '@/lib/supabase/pagination';

const projectColumns = "id,client_id,name,type,status,priority,due_date,progress,responsible,created_at,updated_at,client:clients(name)";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function storageFailure(operation: "list" | "detail" | "create" | "update" | "delete"): never {
  console.error(`[projects] Échec du stockage (${operation}).`);
  throw new Error("Le stockage projets est indisponible. Réessayez plus tard.");
}

export async function listProjects(): Promise<ProjectRecord[]> {
  await requireAdmin();
  try {
    const db=getSupabaseServerClient();
    return await readAllRows<ProjectRecord>(()=>db.from("projects").select(projectColumns).order("created_at", { ascending: false }).order("id"));
  } catch { storageFailure("list"); }
}

export async function listProjectsByClient(clientId: string): Promise<ProjectRecord[]> {
  await requireAdmin();
  if(!uuid.test(clientId))return [];
  try {
    const db=getSupabaseServerClient();
    return await readAllRows<ProjectRecord>(()=>db.from("projects").select(projectColumns).eq("client_id", clientId).order("created_at", { ascending: false }).order("id"));
  } catch { storageFailure("list"); }
}

export async function getProjectById(id: string): Promise<ProjectRecord | null> {
  await requireAdmin();
  if (!uuid.test(id)) return null;
  try {
    const { data, error } = await getSupabaseServerClient().from("projects").select(projectColumns).eq("id", id).maybeSingle();
    if (error) throw new Error();
    return data;
  } catch { storageFailure("detail"); }
}

export async function createProject(formData: FormData): Promise<CreateProjectResult> {
  await requireAdmin();
  const validation = validateProjectForm(formData);
  if (!validation.ok) return { ok: false, state: validation.state };

  try {
    const supabase = getSupabaseServerClient();
    const { data: client, error: clientError } = await supabase.from("clients").select("id").eq("id", validation.data.client_id).maybeSingle();
    if (clientError) throw new Error();
    if (!client) return { ok: false, state: { errors: { client_id: "Ce client n’existe pas." }, values: validation.values } };

    const { data, error } = await supabase.from("projects").insert(validation.data).select("id").single();
    if (error || !data) throw new Error();
    return { ok: true, id: data.id };
  } catch { storageFailure("create"); }
}

export async function updateProject(formData: FormData): Promise<CreateProjectResult> {
  const { userId } = await requireAdmin();
  const idEntries = formData.getAll("id");
  const id = idEntries.length === 1 && typeof idEntries[0] === "string" ? idEntries[0] : "";
  const validation = validateProjectForm(formData);
  if (!uuid.test(id)) return { ok: false, state: { errors: { id: "Projet indisponible." } } };
  if (!validation.ok) return { ok: false, state: validation.state };

  try {
    if (!await clientExists(validation.data.client_id)) return { ok: false, state: { errors: { client_id: "Ce client n’existe pas." }, values: validation.values } };
    const supabase = getSupabaseServerClient();
    const { data: before, error: readError } = await supabase.from("projects").select(projectColumns).eq("id", id).maybeSingle();
    if (readError) throw new Error();
    if (!before) return { ok: false, state: { errors: { id: "Projet indisponible." }, values: validation.values } };
    const { data: after, error: updateError } = await supabase.from("projects").update(validation.data).eq("id", id).select(projectColumns).single();
    if (updateError || !after) throw new Error();
    await writeAuditLog({
      action: "project.updated",
      actor_type: "admin",
      actor_id: userId,
      resource_type: "project",
      resource_id: id,
      before_data: before,
      after_data: after,
      metadata: {},
    });
    return { ok: true, id };
  } catch {
    console.error("[projects] Échec du stockage (update).");
    return { ok: false, state: { message: "Impossible de confirmer la modification. Actualisez la liste avant de réessayer." } };
  }
}

export async function deleteProject(id: string): Promise<DeleteProjectResult> {
  const { userId } = await requireAdmin();
  if (!uuid.test(id)) return { ok: false, message: "Impossible de supprimer ce projet. Actualisez la liste et réessayez." };
  try {
    const supabase = getSupabaseServerClient();
    const { data: before, error: readError } = await supabase.from("projects").select(projectColumns).eq("id", id).maybeSingle();
    if (readError) throw new Error();
    if (!before) return { ok: false, message: "Impossible de supprimer ce projet. Actualisez la liste et réessayez." };
    const { data: deleted, error: deleteError } = await supabase.from("projects").delete().eq("id", id).select("id").maybeSingle();
    if (deleteError || !deleted) throw new Error();
    await writeAuditLog({
      action: "project.deleted",
      actor_type: "admin",
      actor_id: userId,
      resource_type: "project",
      resource_id: id,
      before_data: before,
      after_data: null,
      metadata: {},
    });
    return { ok: true };
  } catch {
    console.error("[projects] Échec du stockage (delete).");
    return { ok: false, message: "Impossible de confirmer la suppression. Rechargez la liste avant de réessayer." };
  }
}

async function clientExists(clientId: string) {
  const { data, error } = await getSupabaseServerClient().from("clients").select("id").eq("id", clientId).maybeSingle();
  if (error) throw new Error();
  return Boolean(data);
}
