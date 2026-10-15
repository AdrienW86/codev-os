// Mode d'exécution par type d'action (sans dépendance : utilisable côté interface).
// « internal » : exécutée par CODE-V OS sans effet externe ; « manual » : réalisée par un humain puis confirmée.
export const internalActionTypes: ReadonlySet<string> = new Set(["internal.test"]);
// « external » : exécutée par CODE-V OS chez un fournisseur après approbation (PR GitHub, jamais de fusion).
export const externalActionTypes: ReadonlySet<string> = new Set(["seo.github_pull_request"]);
export const executionModeOf = (type: string): "internal" | "manual" | "external" => (internalActionTypes.has(type) ? "internal" : externalActionTypes.has(type) ? "external" : "manual");
