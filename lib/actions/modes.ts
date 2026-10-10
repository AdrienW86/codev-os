// Mode d'exécution par type d'action (sans dépendance : utilisable côté interface).
// « internal » : exécutée par CODE-V OS sans effet externe ; « manual » : réalisée par un humain puis confirmée.
export const internalActionTypes: ReadonlySet<string> = new Set(["internal.test"]);
export const executionModeOf = (type: string): "internal" | "manual" => (internalActionTypes.has(type) ? "internal" : "manual");
