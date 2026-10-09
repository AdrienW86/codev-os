// Préférence d’interface : scénario de simulation actif (cookie de session, aucune donnée métier).
export const SIMULATION_COOKIE = "codev-simulation";

export function simulationCookieValue(scenarioId: string | null) {
  return scenarioId
    ? `${SIMULATION_COOKIE}=${encodeURIComponent(scenarioId)}; Path=/; SameSite=Lax`
    : `${SIMULATION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}
