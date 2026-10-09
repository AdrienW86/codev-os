// Sources de données par client : uniquement des IDENTIFIANTS publics (propriété Search Console,
// projet Vercel, dépôt GitHub). Les jetons d'accès restent des variables serveur globales,
// jamais dans les métadonnées d'une connexion.
export type SourceProvider = "search-console" | "vercel" | "github";

export type SourceDefinition = { provider: SourceProvider; label: string; field: "property" | "project_id" | "repository"; placeholder: string; help: string; pattern: RegExp; agent: string };

export const sourceDefinitions: SourceDefinition[] = [
  { provider: "search-console", label: "Search Console", field: "property", placeholder: "sc-domain:exemple.fr", help: "Propriété telle qu’affichée dans Search Console (domaine ou préfixe d’URL https).", pattern: /^(sc-domain:[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)+|https:\/\/[a-z0-9.-]+\.[a-z]{2,}\/)$/i, agent: "Agent SEO & Site" },
  { provider: "vercel", label: "Vercel", field: "project_id", placeholder: "prj_… ou nom-du-projet", help: "Identifiant ou nom du projet Vercel du site.", pattern: /^[a-z0-9_.-]{1,100}$/i, agent: "Agent Monitoring Technique" },
  { provider: "github", label: "GitHub", field: "repository", placeholder: "organisation/depot", help: "Dépôt du site, lu en lecture seule (derniers changements).", pattern: /^[a-z0-9](?:[a-z0-9-]{0,38})\/[a-z0-9._-]{1,100}$/i, agent: "Agent Monitoring Technique" },
];

export function getSourceDefinition(provider: string) {
  return sourceDefinitions.find((item) => item.provider === provider) ?? null;
}

/** Valeur normalisée, ou `null` si refusée ; chaîne vide = retrait de la source. */
export function normalizeSourceValue(provider: string, raw: string): { ok: true; value: string } | { ok: false; message: string } {
  const definition = getSourceDefinition(provider);
  if (!definition) return { ok: false, message: "Source inconnue." };
  const value = raw.trim();
  if (!value) return { ok: true, value: "" };
  if (value.length > 200 || !definition.pattern.test(value) || /\.\./.test(value)) return { ok: false, message: `Format invalide. Exemple : ${definition.placeholder}` };
  return { ok: true, value: definition.provider === "search-console" && /^sc-domain:/i.test(value) ? value.toLowerCase() : value };
}
