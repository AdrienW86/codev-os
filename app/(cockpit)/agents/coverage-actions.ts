"use server";

import { adminMutation, type MutationState } from "@/lib/core/mutation";
import { createMissingAutomations } from "@/lib/agents/coverage-service";
import { runHarnessControl } from "@/lib/harness/control-service";

export async function createMissingAutomationsAction(_: MutationState, _form: FormData): Promise<MutationState> {
  void _form;
  return adminMutation("agents-coverage", (actor) => createMissingAutomations(actor), ["/agents", "/dashboard", "/settings"]);
}

export async function runHarnessControlAction(_: MutationState, _form: FormData): Promise<MutationState> {
  void _form;
  return adminMutation("harness-control", async () => {
    const result = await runHarnessControl(new Date(), { force: true });
    if (!("clients" in result)) return { ok: true, message: "Contrôle déjà effectué." };
    return { ok: result.failed === 0, message: `${result.clients} client(s) contrôlé(s) : ${result.findings} écart(s), ${result.opened} nouvel(le)s alerte(s), ${result.resolved} résolue(s)${result.failed ? `, ${result.failed} client(s) non lus` : ""}.` };
  }, ["/agents", "/dashboard", "/work"]);
}
