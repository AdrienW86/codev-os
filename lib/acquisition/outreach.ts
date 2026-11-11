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

export const TEMPLATE_PLACEHOLDERS = ["entreprise", "ville", "metier", "client", "activite", "benefice"] as const;
type Placeholder = (typeof TEMPLATE_PLACEHOLDERS)[number];
export type TemplateVars = Record<Placeholder, string>;

/**
 * Intérêt du destinataire, par métier prescripteur. Rédigé du point de vue du destinataire
 * (son besoin, ses demandes), sans rien affirmer sur le client : aucun délai, prix ou garantie inventé.
 */
export const SEGMENT_BENEFITS: Record<PrescriberSegmentId, string> = {
  architects: "Sur vos projets, disposer d'une entreprise identifiée pour ce lot vous évite de relancer plusieurs consultations.",
  engineering: "Pour vos consultations, avoir une entreprise de plus qui répond sur ce lot vous aide à comparer et à tenir vos plannings.",
  property_managers: "Vos copropriétaires vous demandent régulièrement des entreprises fiables : avoir un contact identifié vous fait gagner du temps.",
  real_estate_agencies: "Propriétaires, vendeurs et locataires vous demandent souvent un professionnel de confiance : avoir un contact identifié vous permet de répondre tout de suite.",
  developers: "Pour vos programmes, élargir votre liste d'entreprises sur ce lot sécurise vos consultations.",
  home_builders: "Pour vos chantiers, une entreprise de plus sur ce lot vous donne de la souplesse quand vos sous-traitants habituels sont chargés.",
  social_landlords: "Pour l'entretien de votre parc, un prestataire local de plus vous aide à tenir les délais d'intervention.",
  insurance: "Quand un assuré vous demande un artisan après un sinistre, pouvoir lui donner un nom tout de suite améliore sa satisfaction.",
  loss_adjusters: "Pour vos missions, disposer d'une entreprise locale de plus vous aide à obtenir rapidement des devis comparables.",
  diagnostics: "Quand vos diagnostics révèlent des travaux, vos clients vous demandent souvent à qui s'adresser.",
  roofing_framing: "Vos clients ont souvent besoin d'un autre corps de métier sur le même chantier : nous pourrions nous recommander mutuellement.",
  finishing_trades: "Vos clients ont souvent besoin d'un autre corps de métier sur le même chantier : nous pourrions nous recommander mutuellement.",
  plumbing_heating: "Vos clients ont souvent besoin d'un autre corps de métier sur le même chantier : nous pourrions nous recommander mutuellement.",
  electrical: "Vos clients ont souvent besoin d'un autre corps de métier sur le même chantier : nous pourrions nous recommander mutuellement.",
  masonry: "Vos clients ont souvent besoin d'un autre corps de métier sur le même chantier : nous pourrions nous recommander mutuellement.",
  building_cleaning: "Dans les bâtiments que vous entretenez, vous repérez souvent des travaux à faire : avoir un contact à transmettre rend service à vos clients.",
  landscaping: "Vos clients particuliers ont souvent d'autres travaux en tête : nous pourrions nous recommander mutuellement.",
  hospitality: "Pour votre établissement, avoir un professionnel local identifié vous évite de chercher dans l'urgence.",
  kitchen_retail: "Vos clients vous demandent souvent qui peut intervenir avant ou après la pose : avoir un contact identifié vous permet de leur répondre.",
  accountants: "Vos clients vous demandent parfois un prestataire de confiance dans notre domaine : avoir un contact identifié vous permet de leur répondre tout de suite.",
  consultants: "Vos clients vous demandent parfois un prestataire de confiance dans notre domaine : avoir un contact identifié vous permet de leur répondre tout de suite.",
  advertising: "Vos clients ont parfois besoin de compétences complémentaires aux vôtres : nous pourrions nous recommander mutuellement.",
  printers: "Vos clients ont parfois besoin de compétences complémentaires aux vôtres : nous pourrions nous recommander mutuellement.",
  photographers: "Vos clients ont parfois besoin de compétences complémentaires aux vôtres : nous pourrions nous recommander mutuellement.",
  it_services: "Vos clients ont parfois besoin de compétences complémentaires aux vôtres : nous pourrions nous recommander mutuellement.",
};
const GENERIC_BENEFIT = "Vos clients vous demandent parfois un professionnel de confiance : avoir un contact identifié vous permet de leur répondre tout de suite.";

/**
 * Modèle par défaut, construit selon les règles de la prospection B2B : objet court et personnalisé,
 * moins de 120 mots, une raison de contacter propre au destinataire, réciprocité, un seul appel à l'action
 * à faible engagement, aucun lien ni pièce jointe (meilleure délivrabilité d'un premier message).
 */
export const DEFAULT_OUTREACH_TEMPLATE = {
  subject: "{{entreprise}} et {{client}}",
  body: `Bonjour,

Je vous écris car {{entreprise}} exerce à {{ville}}, où {{client}} intervient en {{activite}}.

{{benefice}}

En retour, nous orientons volontiers vers vous ceux de nos clients qui cherchent un professionnel comme vous.

Auriez-vous 10 minutes la semaine prochaine pour en parler ?

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
    benefice: p.segment && Object.hasOwn(SEGMENT_BENEFITS, p.segment) ? SEGMENT_BENEFITS[p.segment as PrescriberSegmentId] : GENERIC_BENEFIT,
  };
}

/** Brouillon prêt à relire : sujet sur une ligne, mention d'opposition toujours présente. */
export function draftMessage(template: { subject: string; body: string }, vars: TemplateVars): { subject: string; body: string } {
  const subject = oneLine(renderTemplate(template.subject, vars), 200);
  const body = `${renderTemplate(template.body, vars).trim()}\n\n${OPT_OUT_FOOTER}`.slice(0, 8000);
  return { subject, body };
}

// ---------------------------------------------------------------------------------------------------------------
// Contrôle qualité d'un brouillon avant approbation : délivrabilité et efficacité d'un premier message B2B.

export type DraftIssue = { level: "warning" | "info"; code: string; message: string };
export type DraftAudit = { score: number; words: number; issues: DraftIssue[] };

/** Expressions qui déclenchent les filtres anti-spam ou abîment la crédibilité d'un premier contact. */
const SPAM_TERMS = ["gratuit", "gratuitement", "urgent", "100 %", "100%", "garanti", "promo", "offre exclusive", "offre speciale", "cliquez ici", "satisfait ou rembourse", "sans engagement", "derniere chance", "meilleur prix", "felicitations", "gagnez"];
/** Valeurs de repli de templateVars : leur présence signale une personnalisation incomplète. */
const FALLBACKS = ["votre secteur", "son métier"];

const fold = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function auditOutreachDraft(draft: { subject: string; body: string }, companyName?: string | null): DraftAudit {
  const issues: DraftIssue[] = [];
  let score = 100;
  const add = (level: DraftIssue["level"], code: string, message: string, cost: number) => { issues.push({ level, code, message }); score -= cost; };
  const main = draft.body.includes(OPT_OUT_FOOTER) ? draft.body.replace(OPT_OUT_FOOTER, "") : draft.body;
  const words = main.split(/\s+/).filter(Boolean).length;
  const all = `${draft.subject}\n${main}`;
  const folded = fold(all);

  if (/\{\{[^}]*\}\}/.test(all)) add("warning", "placeholder", "Une variable n'a pas été remplacée : corriger le modèle.", 40);
  if (!draft.body.includes(OPT_OUT_FOOTER)) add("warning", "opt_out", "La mention d'opposition est absente.", 30);
  if (words > 160) add("warning", "too_long", `${words} mots : un premier message efficace en compte moins de 120.`, 15);
  else if (words > 120) add("info", "long", `${words} mots : viser moins de 120.`, 5);
  else if (words < 35) add("info", "short", `${words} mots : le message risque de paraître impersonnel.`, 5);
  if (draft.subject.length > 60) add("warning", "subject_long", "Objet trop long : il sera tronqué sur mobile (viser 45 caractères).", 10);
  if (!draft.subject.trim()) add("warning", "subject_empty", "Objet vide.", 30);
  const spam = SPAM_TERMS.filter((t) => folded.includes(fold(t)));
  if (spam.length) add("warning", "spam_terms", `Termes à éviter (filtres anti-spam) : ${spam.join(", ")}.`, Math.min(30, 10 * spam.length));
  const links = (all.match(/https?:\/\/|www\./gi) ?? []).length;
  if (links > 1) add("warning", "links", `${links} liens : un premier message ne devrait en contenir aucun ou un seul.`, 10);
  else if (links === 1) add("info", "link", "Un lien : sans lien, un premier message arrive plus souvent en boîte de réception.", 3);
  if ((all.match(/!/g) ?? []).length > 1) add("info", "exclamation", "Plusieurs points d'exclamation : ton trop commercial.", 5);
  if ((all.match(/\b[A-ZÀ-Ý]{5,}\b/g) ?? []).length > 0) add("info", "caps", "Mot en majuscules : à éviter.", 5);
  if (!/\?/.test(main)) add("info", "no_question", "Aucune question : terminer par une demande simple augmente les réponses.", 10);
  const company = companyName?.trim();
  if (company && !all.includes(company)) add("info", "not_personal", "Le nom de l'entreprise destinataire n'apparaît pas.", 10);
  const fallbacks = FALLBACKS.filter((f) => all.includes(f));
  if (fallbacks.length) add("info", "fallback", "Personnalisation incomplète (ville, métier ou activité inconnus) : compléter la fiche ou le client.", 10);
  return { score: Math.max(0, score), words, issues };
}
