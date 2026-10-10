// Analyseur d'intentions déterministe (français) : utilisé sans fournisseur d'IA ou en repli.
// Ne produit que des appels d'outils du registre ; tout le reste reçoit une aide.
import type { ToolName } from "@/lib/assistant/tools";
import { normalize } from "@/lib/assistant/text";
import { hasAdsChange, parseAdsRequest } from "@/lib/assistant/ads-intents";
import type { AssistantContext } from "@/lib/assistant/views";

/** Appel d'outil, ou question de précision quand une information indispensable manque ou est ambiguë. */
export type Intent = { tool: ToolName; input: Record<string, unknown> } | { clarify: string };


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

const weekdayNames = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

/** « mardi à 9h », « demain 14h30 », « le 2026-10-20 à 09:00 » → date (AAAA-MM-JJ) et heure (HH:MM). */
function scheduleParts(value: string, today: string): { date: string; time: string } | null {
  const timeMatch = value.match(/\b(\d{1,2})\s*(?:h|:)\s*(\d{2})?\b/);
  if (!timeMatch || Number(timeMatch[1]) > 23 || Number(timeMatch[2] ?? 0) > 59) return null;
  const time = `${timeMatch[1].padStart(2, "0")}:${(timeMatch[2] ?? "00").padStart(2, "0")}`;
  const explicit = value.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (explicit) return { date: explicit[1], time };
  if (/\bdemain\b/.test(value)) return { date: isoDate(today, 1), time };
  if (/\baujourd hui\b/.test(value)) return { date: today, time };
  const index = weekdayNames.findIndex((day) => new RegExp(`\\b${day}\\b`).test(value));
  if (index < 0) return null;
  const current = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  return { date: isoDate(today, ((index - current + 7) % 7) || 7), time };
}

const weekdayPattern = "lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche";
/** Acronymes et noms de produits qui ne désignent jamais un client. */
const notClients = new Set(["SEO", "SEA", "Ads", "Google", "Search", "Console", "Meta", "Facebook", "Instagram", "IA", "AI", "PageSpeed", "Vercel", "GitHub", "CODE-V", "OS"]);

/**
 * « Crée une tâche … » : toujours une création de tâche, quel que soit le sujet (SEO, site, Ads…).
 * Extrait date / heure (« lundi à 9 h », « demain », « 2026-10-20 »), client et intitulé ;
 * demande une précision si le client ou la date manquent ou sont ambigus. Jamais de valeur inventée.
 */
function parseTask(original: string, value: string, today: string): Intent | null {
  if (!/\b(cree|creer|creez|ajoute|ajouter|ajoutez|note|noter|notez)\b( moi)? (une |la |un )?(nouvelle )?tache\b/.test(value)) return null;
  const start = original.search(/t[âa]che/i);
  let rest = original.slice(start + 5).replace(/^\s*[:\-–—]\s*/, "").trim();

  // Date et heure (retirées de l'intitulé).
  const vague = /\b(la semaine prochaine|le mois prochain|fin du mois|bient[ôo]t|prochainement|plus tard|un de ces jours)\b/i.exec(rest);
  if (vague) return { clarify: `Quelle date précise pour cette tâche (« ${vague[1]} » est ambigu) ? Par exemple « lundi », « demain » ou « 2026-10-20 ».` };
  let due_date: string | undefined, due_time: string | undefined;
  // Pas de \b devant « à » : en JavaScript, \b ignore les lettres accentuées.
  const time = /(?:\s+(?:à|a|vers))?\s*(?<![\d-])(\d{1,2})\s*(?:h|:)\s*(\d{2})?(?![\d])/i.exec(rest);
  if (time) {
    const [hour, minute] = [Number(time[1]), Number(time[2] ?? 0)];
    if (hour > 23 || minute > 59) return { clarify: "L’heure indiquée n’est pas valide. À quelle heure (HH:MM) ?" };
    due_time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    rest = (rest.slice(0, time.index) + " " + rest.slice(time.index + time[0].length)).trim();
  }
  const iso = /\s*\b(?:le\s+)?(\d{4}-\d{2}-\d{2})\b/i.exec(rest);
  const relative = new RegExp(`\\s*\\b(?:(?:ce|le)\\s+)?(demain|aujourd['’]hui|${weekdayPattern})(?:\\s+prochain)?\\b`, "i").exec(rest);
  if (iso) {
    due_date = iso[1];
    rest = (rest.slice(0, iso.index) + " " + rest.slice(iso.index + iso[0].length)).trim();
  } else if (relative) {
    const word = normalize(relative[1]);
    if (word === "demain") due_date = isoDate(today, 1);
    else if (word === "aujourd hui") due_date = today;
    else {
      const index = weekdayNames.indexOf(word);
      const current = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
      due_date = isoDate(today, ((index - current + 7) % 7) || 7);
    }
    rest = (rest.slice(0, relative.index) + " " + rest.slice(relative.index + relative[0].length)).trim();
  } else if (/\ble\s+\d{1,2}(\s|\/|$)/i.test(rest)) {
    return { clarify: "Quelle date exacte pour cette tâche ? Indiquez par exemple « lundi » ou « 2026-10-20 »." };
  }
  if (due_time && !due_date) return { clarify: `Pour quel jour à ${due_time} ? Indiquez par exemple « lundi » ou « demain ».` };
  rest = rest.replace(/\s{2,}/g, " ").replace(/[\s,.;!?]+$/, "").trim();

  // Client : mention explicite, sinon dernier nom propre (hors acronymes), sinon « pour <nom> » final.
  let client: string | null = null;
  let title = rest;
  const explicit = /\b(?:pour le client|du client|client)\s+([^,.;:!?]+)$/i.exec(rest);
  if (explicit) { client = explicit[1].trim(); title = rest.slice(0, explicit.index).trim(); }
  else {
    const words = [...rest.matchAll(/[\p{Lu}][\p{L}\d'’&.-]*(?:\s+(?:&\s+)?[\p{Lu}][\p{L}\d'’&.-]*)*/gu)]
      .filter((match) => match.index! > 0 && !match[0].split(/\s+/).every((word) => notClients.has(word)));
    const last = words.at(-1);
    if (last) {
      client = last[0].split(/\s+/).filter((word) => !notClients.has(word)).join(" ");
      const before = rest.slice(0, last.index).trimEnd();
      // « … pour Jrenov » en fin de phrase : le client ne fait pas partie de l'intitulé.
      if (/\b(pour|chez)$/i.test(before) && last.index! + last[0].length >= rest.length) title = before.replace(/\s*\b(pour|chez)$/i, "").trim();
    } else {
      const trailing = /\s+pour\s+([\p{L}\d'’&.-]+(?:\s+[\p{L}\d'’&.-]+){0,3})$/u.exec(rest);
      if (trailing && !/^(v[ée]rifier|faire|pr[ée]parer|relancer|corriger|mettre|envoyer|appeler)\b/i.test(trailing[1])) { client = trailing[1]; title = rest.slice(0, trailing.index).trim(); }
    }
  }
  title = title.replace(/^(pour|afin de|de)\s+/i, "").replace(/^[«"]\s*|\s*[»"]$/g, "").trim();
  if (title.length < 2) return { clarify: "Quel est l’intitulé de la tâche à créer ?" };
  if (!client) return { clarify: `Pour quel client dois-je créer la tâche « ${title.slice(0, 80)} » ?` };
  return {
    tool: "create_task",
    input: { title: (title[0].toUpperCase() + title.slice(1)).slice(0, 200), client: client.slice(0, 120), ...(due_date ? { due_date } : {}), ...(due_time ? { due_time } : {}), priority: /\b(urgent|prioritaire)\b/.test(value) ? "Haute" : "Moyenne" },
  };
}

/** Paramètres de l'outil ads_campaigns à partir d'une demande lue (seuls les éléments mentionnés). */
function adsInput(request: ReturnType<typeof parseAdsRequest>): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  if (request.client) input.client = request.client;
  if (request.period) {
    input.period = request.period.preset;
    if (request.period.date) input.date = request.period.date;
    if (request.period.start) input.start = request.period.start;
    if (request.period.end) input.end = request.period.end;
  }
  if (request.status) input.status = request.status;
  if (request.types) input.types = request.types;
  if (request.compare !== undefined) input.compare = request.compare;
  return input;
}

export function parseIntent(text: string, today: string, context: AssistantContext = {}): Intent | null {
  const original = text.trim().slice(0, 500);
  const value = normalize(original);
  if (!value) return null;

  // Création de tâche : prioritaire sur toute autre lecture de la phrase (le sujet peut contenir « SEO », « vérifier »…).
  const task = parseTask(original, value, today);
  if (task) return task;

  // Google Ads en consultation : nouvelle vue, ou suite de la vue courante (« et sur 7 jours ? », « uniquement Local Services »).
  const ads = parseAdsRequest(original);
  const inAdsView = context.view === "ads_campaigns";
  if ((ads.mentionsAds || inAdsView) && /\b(recommand\w*|conseill\w*|conseils?|optimis\w*)\b/.test(value)) {
    if (ads.clarify) return { clarify: ads.clarify };
    return { tool: "ads_recommendations", input: { ...adsInput(ads), ...(/\b(actualis\w*|rafraich\w*)\b/.test(value) ? { refresh: true } : {}) } };
  }
  const launches = /\b(verifie|controle|lance|analyse|check|audit|planifie|programme)\b/.test(value);
  const followUp = inAdsView && !launches && (hasAdsChange(ads) || (ads.followUp && Boolean(ads.client)));
  if ((ads.mentionsAds && ads.display && !launches) || followUp) {
    if (ads.clarify) return { clarify: ads.clarify };
    return { tool: "ads_campaigns", input: adsInput(ads) };
  }

  if (/\bactions?\b.*\b(a valider|en attente)|\b(a valider|en attente)\b.*\bactions?\b/.test(value)) return { tool: "list_pending_actions", input: {} };
  if (/\bclients?\b.*\b(attention|surveiller|probleme|a risque)/.test(value)) return { tool: "clients_attention", input: {} };
  if (/\b(urgence|urgent|priorit|a valider|a traiter|quoi faire|qu est ce que je fais)/.test(value)) return { tool: "get_priorities", input: {} };
  if (/\b(actualit|veille|news|nouveaute)/.test(value) && !/\blance|relance|rafraich/.test(value)) return { tool: "list_news", input: {} };
  const schedulingAnalysis = /\b(planifie|programme|prevois)\b.*\b(sites?|seo|audit|ads|campagnes?|veille|monitoring)\b/.test(value);
  if (!schedulingAnalysis && /\b(agenda|planning|programme|aujourd hui|ma journee)\b/.test(value) && !/\btache\b.*\bcree|cree.*tache/.test(value)) return { tool: "agenda_today", input: {} };

  if (/\brapport/.test(value)) {
    const client = clientAfter(original);
    const kind = /mensuel|du mois|mois dernier/.test(value) ? "monthly" : "weekly";
    if (client && /\b(genere|prepare|fais|cree|redige|lance)/.test(value)) return { tool: "generate_report", input: { client, kind } };
    return { tool: "list_reports", input: client ? { client } : {} };
  }

  const scheduled = /\b(planifie|programme|prevois)\b/.test(value) ? scheduleParts(value, today) : null;

  const checks: [RegExp, string][] = [[/\b(sites?|en ligne|monitoring|disponibilit\w*|down)\b/, "monitoring.check_sites"], [/\bseo|search console|referencement\b/, "seo.analyze"], [/\b(ads|campagnes?|google ads)\b/, "ads.monitor"]];
  if (scheduled || /\b(verifie|controle|lance|analyse|check|teste|audit)/.test(value)) {
    for (const [pattern, check] of checks) if (pattern.test(value)) {
      const client = check === "monitoring.check_sites" ? null : clientAfter(original.replace(/\s+(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|demain|aujourd['’]hui)\b.*$/i, ""));
      if (scheduled) return { tool: "schedule_check", input: { check, ...(client ? { client } : {}), ...scheduled } };
      return { tool: "run_check", input: { check, ...(client ? { client } : {}) } };
    }
  }

  const client = clientAfter(original, ["client", "sur", "pour", "de"]);
  if (client && /\b(ou en est|point sur|resume|situation|vue d ensemble|comment va|etat)\b/.test(value)) return { tool: "client_overview", input: { client } };
  return null;
}

export const assistantHelp = "Je peux : afficher les campagnes Google Ads d’un client (période, statut, type, comparaison), résumer vos urgences, faire le point sur un client, afficher l’agenda du jour, lister ou générer un rapport, lancer ou planifier un contrôle des sites, une analyse SEO ou la veille Google Ads, lister les actions à valider, repérer les clients à surveiller et créer une tâche. Exemple : « Génère le rapport hebdomadaire pour Boulangerie Martin ».";
