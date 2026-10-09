import type { ProjectInsert, ProjectRow } from "@/lib/supabase/database.types";

export type ProjectRecord = ProjectRow & { client: { name: string } | null };
export type ProjectField = "client_id" | "name" | "type" | "status" | "priority" | "due_date" | "progress" | "responsible";
export type ProjectFormState = {
  errors?: Partial<Record<ProjectField | "id", string>>;
  values?: Partial<Record<ProjectField | "id", string>>;
  message?: string;
};
export type CreateProjectResult = { ok: true; id: string } | { ok: false; state: ProjectFormState };
export type DeleteProjectResult = { ok: true } | { ok: false; message: string };
export type { ProjectInsert };