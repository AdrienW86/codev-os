/**
 * Passage d'une liste de prospects à la prospection e-mail : sélection des fiches
 * contactables et rédaction des brouillons à partir d'un modèle. Fonctions pures,
 * aucun envoi : les brouillons attendent une approbation humaine dans l'onglet E-mails.
 */
import { PRESCRIBER_SEGMENTS, type PrescriberSegmentId } from "./prescribers";

/** Nombre maximal de brouillons créés en une fois (relecture humaine réaliste). */
export const HANDOFF_MAX = 200;
/** Étapes depuis lesquelles une fiche peut recevoir un premier brouillon. */
export const HANDOFF_STAGES = ["discovered", "verified", "qualified"] as const;

export const TEMPLATE_PLACEHOLDERS = ["entreprise", "ville", "metier", "client", "activite"] as const;
type Placeholder = (typeof TEMPLATE_PLACEHOLDERS)[number];
export type TemplateVars = Record<Placeholder, string>;

/** Modèle par défaut : un client présente son activité à un professionnel susceptible de le recommander. */
export const DEFAULT_OUTREACH_TEMPLATE = {
  subject: "{{client}} — collaboration avec {{entreprise}}",
  body: `Bonjour,

Je me permets de vous contacter car {{entreprise}} ({{metier}}) exerce à {{ville}}, sur le même secteur que nous.
{{client}} est spécialisé en {{activite}} et travaille régulièrement avec des professionnels comme vous.

Seriez-vous ouvert à un bref échange pour voir si nous pourrions nous recommander mutuellement auprès de nos clients ?

Bien cordialement,
{{client}}`,
} as const;

/** Mention ajoutée à chaque brouillon (droit d'opposition, art. 21 RGPD). */
export const OPT_OUT_FOOTER = "Vous recevez ce message car votre adresse professionnelle est publiée sur votre site. Si vous ne souhaitez plus être contacté, répondez simplement « STOP ».";

const oneLine = (v: string, max: number) => v.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, max);

/** Remplace les variables connues ; une variable inconnue reste visible pour être corrigée à la relecture. */
export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{\s*([a-z]+)\s*\}\}/gi, (match, name: string) => {
    const key = name.toLowerCase() as Placeholder;
    return (TEMPLATE_PLACEHOLDERS as readonly string[]).includes(key) ? oneLine(vars[key], 200) : match;
  });
}

export type HandoffProspect = {
  id: string; company_name: string; category: string; stage: string; score: number | null;
  segment?: string | null; city?: string | null; contact_email?: string | null;
};
export type HandoffFilter = { category?: string; segment?: string; minScore?: number };
export type HandoffSkip = "no_email" | "stage" | "filtered" | "already_drafted" | "suppressed" | "duplicate_email" | "limit";

/**
 * Retient les fiches à transmettre, par score décroissant. Une adresse déjà exclue,
 * déjà destinataire d'un message ou présente deux fois n'est retenue qu'au plus une fois.
 */
export function selectHandoffProspects(prospects: HandoffProspect[], filter: HandoffFilter, context: {
  draftedProspectIds: Set<string>; usedEmails: Set<string>; isSuppressed: (email: string) => boolean; limit?: number;
}): { selected: (HandoffProspect & { email: string })[]; skipped: Record<HandoffSkip, number> } {
  const skipped: Record<HandoffSkip, number> = { no_email: 0, stage: 0, filtered: 0, already_drafted: 0, suppressed: 0, duplicate_email: 0, limit: 0 };
  const limit = Math.min(context.limit ?? HANDOFF_MAX, HANDOFF_MAX);
  const seen = new Set(context.usedEmails);
  const selected: (HandoffProspect & { email: string })[] = [];
  const ordered = [...prospects].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  for (const p of ordered) {
    if ((filter.category && p.category !== filter.category) || (filter.segment && p.segment !== filter.segment) || (filter.minScore && (p.score ?? 0) < filter.minScore)) { skipped.filtered++; continue; }
    const email = p.contact_email?.trim().toLowerCase() ?? "";
    if (!email) { skipped.no_email++; continue; }
    if (!(HANDOFF_STAGES as readonly string[]).includes(p.stage)) { skipped.stage++; continue; }
    if (context.draftedProspectIds.has(p.id)) { skipped.already_drafted++; continue; }
    if (context.isSuppressed(email)) { skipped.suppressed++; continue; }
    if (seen.has(email)) { skipped.duplicate_email++; continue; }
    if (selected.length >= limit) { skipped.limit++; continue; }
    seen.add(email);
    selected.push({ ...p, email });
  }
  return { selected, skipped };
}

export function templateVars(p: HandoffProspect, client: { name: string; activity: string | null }): TemplateVars {
  const segment = p.segment && Object.hasOwn(PRESCRIBER_SEGMENTS, p.segment) ? PRESCRIBER_SEGMENTS[p.segment as PrescriberSegmentId].label.toLocaleLowerCase("fr") : "professionnel";
  return {
    entreprise: p.company_name, ville: p.city || "votre secteur", metier: segment,
    client: client.name, activite: (client.activity || "son métier").toLocaleLowerCase("fr"),
  };
}

/** Brouillon prêt à relire : sujet sur une ligne, mention d'opposition toujours présente. */
export function draftMessage(template: { subject: string; body: string }, vars: TemplateVars): { subject: string; body: string } {
  const subject = oneLine(renderTemplate(template.subject, vars), 200);
  const body = `${renderTemplate(template.body, vars).trim()}\n\n${OPT_OUT_FOOTER}`.slice(0, 8000);
  return { subject, body };
}
