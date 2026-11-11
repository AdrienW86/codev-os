"use server";

import { adminMutation, type MutationState } from "@/lib/core/mutation";
import { createMissingAutomations } from "@/lib/agents/coverage-service";

export async function createMissingAutomationsAction(_: MutationState, _form: FormData): Promise<MutationState> {
  void _form;
  return adminMutation("agents-coverage", (actor) => createMissingAutomations(actor), ["/agents", "/dashboard", "/settings"]);
}
