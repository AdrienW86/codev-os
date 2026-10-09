"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/require-admin";
import { createTask } from "@/lib/tasks/data";
import type { TaskFormState } from "@/lib/tasks/types";

export async function createTaskAction(_previousState: TaskFormState, formData: FormData): Promise<TaskFormState> {
  await requireAdmin();
  const result = await createTask(formData);
  if (!result.ok) return result.state;
  revalidatePath("/tasks");
  revalidatePath("/clients");
  redirect("/tasks");
}