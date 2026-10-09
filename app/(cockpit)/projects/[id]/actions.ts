"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/require-admin";
import { deleteProject, updateProject } from "@/lib/projects/data";
import type { ProjectFormState } from "@/lib/projects/types";
import type { DeleteFormState } from "@/lib/action-state";

export async function updateProjectAction(_previousState: ProjectFormState, formData: FormData): Promise<ProjectFormState> {
  await requireAdmin();
  const result = await updateProject(formData);
  if (!result.ok) return result.state;
  revalidatePath("/projects");
  revalidatePath("/clients");
  revalidatePath("/tasks");
  redirect("/projects");
}

export async function deleteProjectAction(_previousState: DeleteFormState, formData: FormData): Promise<DeleteFormState> {
  await requireAdmin();
  const entries = formData.getAll("id");
  const id = entries.length === 1 && typeof entries[0] === "string" ? entries[0] : "";
  if (!id) return { message: "Impossible de supprimer ce projet. Actualisez la liste et réessayez." };
  const result = await deleteProject(id);
  if (!result.ok) return { message: result.message };
  revalidatePath("/projects");
  revalidatePath("/clients");
  revalidatePath("/tasks");
  redirect("/projects");
}