"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/require-admin";
import { deleteTask, updateTask } from "@/lib/tasks/data";
import type { TaskFormState } from "@/lib/tasks/types";
import type { DeleteFormState } from "@/lib/action-state";

export async function updateTaskAction(_previousState: TaskFormState, formData: FormData): Promise<TaskFormState> {
  await requireAdmin();
  const result = await updateTask(formData);
  if (!result.ok) return result.state;
  revalidatePath("/tasks");
  revalidatePath("/clients");
  revalidatePath("/projects");
  redirect("/tasks");
}

export async function deleteTaskAction(_previousState: DeleteFormState, formData: FormData): Promise<DeleteFormState> {
  await requireAdmin();
  const entries = formData.getAll("id");
  const id = entries.length === 1 && typeof entries[0] === "string" ? entries[0] : "";
  if (!id) return { message: "Impossible de supprimer cette tâche. Actualisez la liste et réessayez." };
  const result = await deleteTask(id);
  if (!result.ok) return { message: result.message };
  revalidatePath("/tasks");
  revalidatePath("/clients");
  revalidatePath("/projects");
  redirect("/tasks");
}