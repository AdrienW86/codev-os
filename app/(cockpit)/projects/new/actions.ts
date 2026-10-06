"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/require-admin";
import { createProject } from "@/lib/projects/data";
import type { ProjectFormState } from "@/lib/projects/types";

export async function createProjectAction(_previousState: ProjectFormState, formData: FormData): Promise<ProjectFormState> {
  await requireAdmin();
  const result = await createProject(formData);
  if (!result.ok) return result.state;
  revalidatePath("/projects");
  revalidatePath("/clients");
  revalidatePath("/tasks/new");
  redirect("/projects");
}