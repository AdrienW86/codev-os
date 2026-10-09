"use server";

import { revalidatePath } from "next/cache";
import { requireAdminWriter, SimulationWriteBlocked } from "@/lib/core/guards";
import { activateService, deactivateService, RegistryNotInstalled } from "@/lib/services/domain";

export type ServiceActionState = { ok?: boolean; message?: string };

const field = (form: FormData, name: string) => { const value = form.get(name); return typeof value === "string" ? value.trim().slice(0, 100) : ""; };

async function run(form: FormData, operation: typeof activateService): Promise<ServiceActionState> {
  let actor;
  try { actor = await requireAdminWriter(); } catch (error) { if (error instanceof SimulationWriteBlocked) return { ok: false, message: error.message }; throw error; }
  const clientId = field(form, "client_id");
  try {
    const result = await operation(actor, clientId, field(form, "service_key"));
    if (!result.ok) return { ok: false, message: result.message };
    revalidatePath(`/clients/${clientId}`);
    const pending = result.agents.filter((agent) => !agent.ready).map((agent) => agent.name);
    if (result.lifecycle === "ended") return { ok: true, message: "Service désactivé. Les agents liés sont arrêtés pour ce client ; l’historique est conservé." };
    return { ok: true, message: pending.length ? `Service activé. À configurer : ${pending.join(", ")}.` : "Service activé. Les agents associés sont rattachés au client." };
  } catch (error) {
    if (error instanceof RegistryNotInstalled) return { ok: false, message: error.message };
    console.error("[services] Opération indisponible.");
    return { ok: false, message: "Opération indisponible. Réessayez dans quelques instants." };
  }
}

export async function activateServiceAction(_: ServiceActionState, form: FormData) { return run(form, activateService); }
export async function deactivateServiceAction(_: ServiceActionState, form: FormData) { return run(form, deactivateService); }
