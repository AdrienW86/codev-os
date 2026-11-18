// Résultat lisible d'un lancement manuel (pur) : comptes du planificateur traduits en phrases françaises, détail du
// vrai résultat (relevé, audit, contrôle) et écran où le retrouver. Aucune donnée inventée : rien relevé = dit tel quel.
import { readScores } from "@/lib/performance/weekly-model";

type Phrase = readonly [one: string, many: string];
const phrases: Record<string, Phrase> = {
  collected: ["relevé enregistré", "relevés enregistrés"],
  points: ["point de carte relevé", "points de carte relevés"],
  audited: ["site audité", "sites audités"],
  checked: ["site vérifié", "sites vérifiés"],
  findings: ["constat", "constats"],
  opened: ["alerte ouverte", "alertes ouvertes"],
  alerts: ["alerte ouverte", "alertes ouvertes"],
  resolved: ["alerte résolue", "alertes résolues"],
  approved: ["rapport approuvé", "rapports approuvés"],
  archived: ["rapport remplacé archivé", "rapports remplacés archivés"],
  candidates: ["publication sans image", "publications sans image"],
  generated: ["image générée (à valider)", "images générées (à valider)"],
  budget: ["image bloquée par le budget IA", "images bloquées par le budget IA"],
  due: ["publication à relever", "publications à relever"],
  ok: ["statistique relevée", "statistiques relevées"],
  runs: ["recherche avancée", "recherches avancées"],
  failed: ["échec", "échecs"],
};

const disabledLabels: Record<string, string> = { agent: "agent en pause", migration: "module non installé", provider: "fournisseur non configuré", google: "Google non connecté", vault: "coffre de jetons absent", credential: "clé API absente", global: "arrêt général actif", true: "désactivé" };
export const disabledLabel = (reason: string) => disabledLabels[reason] ?? reason;

const plural = (n: number, [one, many]: Phrase) => `${n} ${n > 1 ? many : one}`;

/** Résumé d'un passage du planificateur : « Terminé : 2 relevés enregistrés, aucune alerte. » */
export function countSummary(summary: unknown, keys: readonly string[]): string {
  const s = (summary ?? {}) as Record<string, unknown>;
  if (s.disabled) return `Non lancé : ${disabledLabel(String(s.disabled))}.`;
  if (s.outside_window) return "Non lancé : hors fenêtre.";
  const value = (k: string) => (typeof s[k] === "number" ? (s[k] as number) : null);
  const parts = keys.flatMap((k) => { const n = value(k); return n && phrases[k] ? [plural(n, phrases[k])] : []; });
  if (!parts.length) return "Terminé : rien de nouveau à relever.";
  const alertKey = keys.find((k) => k === "alerts" || k === "opened");
  if (alertKey && value(alertKey) === 0) parts.push("aucune alerte");
  return `Terminé : ${parts.join(", ")}.`;
}

/** Écran où voir le vrai résultat d'une tâche lancée (null : le résultat tient dans le message). */
export function resultHref(taskId: string, clientId: string | null): string | null {
  const q = (base: string, extra = "") => (clientId ? `${base}${base.includes("?") ? "&" : "?"}client=${clientId}${extra}` : base);
  switch (taskId) {
    case "harness-control": return "/work?kind=incident";
    case "auto-decisions": return "/reports";
    case "publication-photo": return "/publications/images";
    case "publication-stats": return "/publications/published";
    case "search-console": return q("/analytics?source=seo");
    case "google-analytics": return q("/analytics");
    case "local-seo": return q("/analytics?source=local", "#fiche-google");
    case "local-competition": return q("/analytics?source=local", "#concurrence-locale");
    case "local-geogrid": return q("/analytics?source=local", "#carte-positions");
    case "lighthouse": return "/performance";
    case "site-health": return null;
    case "monitoring": return clientId ? `/clients/${clientId}?tab=health` : null;
    case "seo-analyze": return clientId ? `/recommendations?clientId=${clientId}` : "/recommendations";
    case "ads-monitor": return q("/advertising");
    case "veille": return "/news";
    case "prospection": return "/acquisition";
    default: return null;
  }
}

const strategyLabel = (s: string) => (s === "desktop" ? "Ordinateur" : "Mobile");
/** Audit Lighthouse : une ligne par appareil avec les quatre notes. */
export function lighthouseDetails(rows: readonly { strategy: string; scores: unknown }[]): string[] {
  return rows.map((row) => {
    const s = readScores(row.scores);
    const parts = [["performance", s.performance], ["accessibilité", s.accessibility], ["bonnes pratiques", s.bestPractices], ["SEO", s.seo]]
      .flatMap(([label, v]) => (typeof v === "number" ? [`${label} ${Math.round(v)}/100`] : []));
    return `${strategyLabel(row.strategy)} : ${parts.length ? parts.join(", ") : "notes illisibles"}.`;
  });
}

const severityLabel: Record<string, string> = { critical: "critique", high: "important", medium: "moyen", low: "mineur" };
/** Santé technique : note, puis les problèmes du plus grave au moins grave (5 au plus), avec la correction. */
export function siteHealthDetails(row: { score: unknown; findings: unknown; url?: string | null } | null): string[] {
  if (!row) return ["Aucun contrôle enregistré pour ce client (site absent de la fiche client ?)."];
  const order = ["critical", "high", "medium", "low"];
  const findings = (Array.isArray(row.findings) ? row.findings : [])
    .filter((f): f is { severity: string; title: string; fix?: string } => Boolean(f) && typeof f === "object" && typeof (f as { title?: unknown }).title === "string")
    .sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  const lines = [`Note de santé technique${row.url ? ` de ${row.url}` : ""} : ${typeof row.score === "number" ? `${Math.round(row.score)}/100` : "non calculée"}.`];
  if (!findings.length) lines.push("Aucun problème détecté (certificat, domaine, DNS, robots.txt, sitemap, pages, indexation).");
  for (const f of findings.slice(0, 5)) lines.push(`${f.title} (${severityLabel[f.severity] ?? f.severity})${f.fix ? ` : ${f.fix}` : "."}`);
  if (findings.length > 5) lines.push(`Et ${findings.length - 5} autre(s) point(s) moins graves.`);
  return lines;
}
