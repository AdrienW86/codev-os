import "server-only";
import { requireAdmin } from "@/lib/require-admin";
import { getActiveScenario } from "@/lib/simulation/server";
import type { Actor } from "@/lib/core/actor";

export class SimulationWriteBlocked extends Error {
  constructor() { super("Simulation active : aucune écriture réelle n’est effectuée."); }
}

/** Point d'entrée d'une mutation déclenchée par l'administrateur : session vérifiée, simulation exclue. */
export async function requireAdminWriter(): Promise<Actor & { kind: "admin" }> {
  const { userId } = await requireAdmin();
  if (await getActiveScenario()) throw new SimulationWriteBlocked();
  return { kind: "admin", userId };
}

export async function isSimulationActive() {
  return Boolean(await getActiveScenario());
}
