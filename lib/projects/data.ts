import "server-only";
import { requireAdmin } from "@/lib/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { auditedMutation, plainColumns } from "@/lib/core/audited-mutation";
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
  const { userId } = await requireAdmin();
  const validation = validateProjectForm(formData);
  if (!validation.ok) return { ok: false, state: validation.state };

  try {
    const supabase = getSupabaseServerClient();
    const { data: client, error: clientError } = await supabase.from("clients").select("id").eq("id", validation.data.client_id).maybeSingle();
    if (clientError) throw new Error();
    if (!client) return { ok: false, state: { errors: { client_id: "Ce client n’existe pas." }, values: validation.values } };

    // Création et journal dans la même transaction (audit P1-03).
    const data = await auditedMutation<{ id: string }>({ table: "projects", operation: "insert", values: validation.data, columns: ["id"], auditColumns: plainColumns(projectColumns),
      audit: { action: "project.created", resource_type: "project", actor_type: "admin", actor_id: userId } });
    if (!data) throw new Error();
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
    const after = await auditedMutation({ table: "projects", operation: "update", id, values: validation.data, columns: ["id"], auditColumns: plainColumns(projectColumns),
      audit: { action: "project.updated", resource_type: "project", resource_id: id, actor_type: "admin", actor_id: userId } });
    if (!after) return { ok: false, state: { errors: { id: "Projet indisponible." }, values: validation.values } };
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
    const deleted = await auditedMutation({ table: "projects", operation: "delete", id, columns: ["id"], auditColumns: plainColumns(projectColumns),
      audit: { action: "project.deleted", resource_type: "project", resource_id: id, actor_type: "admin", actor_id: userId } });
    if (!deleted) return { ok: false, message: "Impossible de supprimer ce projet. Actualisez la liste et réessayez." };
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
