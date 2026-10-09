import "server-only";
import { cookies } from "next/headers";
import { SIMULATION_COOKIE } from "@/lib/simulation/cookie";
import { getScenario } from "@/lib/simulation/scenarios";

/** Scénario actif, ou `null` : en simulation, les pages n’affichent que des données fictives. */
export async function getActiveScenario() {
  const value = (await cookies()).get(SIMULATION_COOKIE)?.value;
  return getScenario(value ? decodeURIComponent(value) : null);
}
