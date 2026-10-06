import type { TaskInsert, TaskRow } from "@/lib/supabase/database.types";

export type TaskRecord = TaskRow & {
  client: { name: string } | null;
  project: { name: string } | null;
};
export type TaskField = "id" | "assignee_id" | "client_id" | "project_id" | "title" | "status" | "priority" | "due_date" | "assignee_type";
export type TaskFormState = {
  errors?: Partial<Record<TaskField, string>>;
  values?: Partial<Record<TaskField, string>>;
  message?: string;
};
export type CreateTaskResult = { ok: true; id: string } | { ok: false; state: TaskFormState };
export type { TaskInsert };