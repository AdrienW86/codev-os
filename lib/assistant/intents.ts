// Analyseur d'intentions déterministe (français) : utilisé sans fournisseur d'IA ou en repli.
// Ne produit que des appels d'outils du registre ; tout le reste reçoit une aide.
import type { ToolName } from "@/lib/assistant/tools";

export type Intent = { tool: ToolName; input: Record<string, unknown> };

const normalize = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’']/g, " ").replace(/\s+/g, " ").trim();

/** Nom de client après « pour », « de », « du client »… (texte d'origine conservé). */
function clientAfter(original: string, markers = ["pour le client", "du client", "pour", "client", "chez", "de"]) {
  for (const marker of markers) {
    const match = original.match(new RegExp(`(?:^|\\s)${marker}\\s+(?:l'|l’|la |le |les )?([^,.;:!?]+?)(?:\\s+(?:pour|avec|avant|le|la|cette|ce|demain|aujourd)\\b|[,.;:!?]|$)`, "i"));
    if (match?.[1]?.trim()) return match[1].trim().slice(0, 120);
  }
  return null;
}

function isoDate(today: string, offset: number) {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function parseIntent(text: string, today: string): Intent | null {
  const original = text.trim().slice(0, 500);
  const value = normalize(original);
  if (!value) return null;

  if (/\b(urgence|urgent|priorit|a valider|a traiter|quoi faire|qu est ce que je fais)/.test(value)) return { tool: "get_priorities", input: {} };
  if (/\b(actualit|veille|news|nouveaute)/.test(value) && !/\blance|relance|rafraich/.test(value)) return { tool: "list_news", input: {} };
  if (/\b(agenda|planning|programme|aujourd hui|ma journee)\b/.test(value) && !/\btache\b.*\bcree|cree.*tache/.test(value)) return { tool: "agenda_today", input: {} };

  const taskMatch = original.match(/(?:cr[ée]e|ajoute|note)[r]?\s+(?:une\s+)?t[âa]che\s+(?:«\s*|")?(.+?)(?:\s*»|")?\s+pour\s+([^,.;:!?]+?)(?:\s+(demain|aujourd['’]hui))?\s*[.!?]?$/i);
  if (taskMatch) {
    const due = taskMatch[3] ? isoDate(today, /demain/i.test(taskMatch[3]) ? 1 : 0) : undefined;
    return { tool: "create_task", input: { title: taskMatch[1].trim().slice(0, 200), client: taskMatch[2].trim(), ...(due ? { due_date: due } : {}), priority: /urgent|prioritaire/.test(value) ? "Haute" : "Moyenne" } };
  }

  if (/\brapport/.test(value)) {
    const client = clientAfter(original);
    const kind = /mensuel|du mois|mois dernier/.test(value) ? "monthly" : "weekly";
    if (client && /\b(genere|prepare|fais|cree|redige|lance)/.test(value)) return { tool: "generate_report", input: { client, kind } };
    return { tool: "list_reports", input: client ? { client } : {} };
  }

  const checks: [RegExp, string][] = [[/\b(sites?|en ligne|monitoring|disponibilit\w*|down)\b/, "monitoring.check_sites"], [/\bseo|search console|referencement\b/, "seo.analyze"], [/\b(ads|campagnes?|google ads)\b/, "ads.monitor"]];
  if (/\b(verifie|controle|lance|analyse|check|teste)/.test(value)) {
    for (const [pattern, check] of checks) if (pattern.test(value)) {
      const client = check === "monitoring.check_sites" ? null : clientAfter(original);
      return { tool: "run_check", input: { check, ...(client ? { client } : {}) } };
    }
  }

  const client = clientAfter(original, ["client", "sur", "pour", "de"]);
  if (client && /\b(ou en est|point sur|resume|situation|vue d ensemble|comment va|etat)\b/.test(value)) return { tool: "client_overview", input: { client } };
  return null;
}

export const assistantHelp = "Je peux : résumer vos urgences, faire le point sur un client, afficher l’agenda du jour, lister ou générer un rapport, lancer un contrôle des sites, une analyse SEO ou la veille Google Ads, et créer une tâche. Exemple : « Génère le rapport hebdomadaire pour Boulangerie Martin ».";
