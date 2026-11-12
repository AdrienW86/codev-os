// Chef d'orchestre : contrôle quotidien de chaque client. Compare ce qui est attendu (services souscrits, réglages)
// à ce qui est réellement prévu, et nomme chaque écart. Fonction pure : le service ouvre ou résout les incidents.
import type { ClientFacts, ClientPlan } from "./client-plan";

export type ControlFinding = { code: string; severity: "medium" | "high"; title: string };

export const controlFingerprint = (clientId: string, code: string) => `harness:${clientId}:${code}`.slice(0, 200);
export const controlPrefix = (clientId: string) => `harness:${clientId}:`;

const SEARCH_CONSOLE_STALE_MS = 3 * 86_400_000;
const frenchDate = (iso: string) => new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit" }).format(new Date(iso));

export function controlFindings(facts: ClientFacts, plan: ClientPlan, now = new Date()): ControlFinding[] {
  const findings: ControlFinding[] = [];
  for (const seat of plan.seats) {
    if (seat.state === "needs_setup") findings.push({ code: `setup:${seat.agent}`, severity: "medium", title: `${seat.name} : ${seat.detail}` });
  }
  const pub = facts.publication;
  const pubWorking = plan.seats.some((seat) => seat.agent === "publications" && seat.state === "working");
  if (pubWorking && pub && pub.publishingEnabled !== false && pub.scheduledNext7Days === 0) {
    findings.push({ code: "publications:empty-week", severity: "high", title: "Agent Publications : aucune diffusion programmée sur les 7 prochains jours." });
  }
  const blog = facts.blog;
  const blogWorking = plan.seats.some((seat) => seat.agent === "blog" && seat.state === "working");
  if (blogWorking && blog?.scheduledNext7Days === 0 && blog.publishedLast7Days === 0) {
    findings.push({ code: "blog:idle", severity: "medium", title: "Agent Blog : aucun article publié sur 7 jours ni prévu sur les 7 prochains." });
  }
  // Search Console : sans données fraîches, l'Agent SEO travaille sur des chiffres périmés. La cause est nommée.
  const sc = facts.searchConsole;
  if (sc && (!sc.lastSyncAt || now.getTime() - Date.parse(sc.lastSyncAt) > SEARCH_CONSOLE_STALE_MS)) {
    const since = sc.lastSyncAt ? `depuis le ${frenchDate(sc.lastSyncAt)}` : "depuis sa connexion";
    const why = sc.lastFailureKind === "unauthorized"
      ? ` : Google refuse l'accès à ${sc.property}, ajoutez le compte Google de l'application comme utilisateur de la propriété`
      : sc.lastFailureKind === "not_found" ? ` : propriété ${sc.property} introuvable, vérifiez son nom` : "";
    findings.push({ code: "search-console:stale", severity: "high", title: `Search Console ne se synchronise plus ${since}${why}.` });
  }
  return findings;
}

const START_HOUR = 7;
const parisDay = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
const parisHour = (date: Date) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(date));

/** Faut-il lancer le contrôle maintenant ? Une fois par jour (heure de Paris), à partir de 7 h. */
export function controlDue(now: Date, lastStartedAt: string | null) {
  if (parisHour(now) < START_HOUR) return false;
  return !lastStartedAt || parisDay(new Date(lastStartedAt)) !== parisDay(now);
}
