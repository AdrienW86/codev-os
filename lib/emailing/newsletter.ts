// Agent Newsletter (pur, testable) : consignes d'expert, schéma de sortie, contrôle anti-invention, contrôle qualité
// (délivrabilité et lisibilité) et rendu HTML/texte sûr d'une newsletter de client.
import { unsupportedClaims } from "@/lib/publications/agent-v2/selection";

export type NewsletterSection = { title: string; body: string; url: string | null };
export type NewsletterContent = {
  subject: string; preheader: string; intro: string; sections: NewsletterSection[];
  cta: { label: string; url: string } | null; signoff: string;
};
/** Faits que l'agent peut citer : rien d'autre (prix, délais, garanties, chantiers…) n'est accepté. */
export type NewsletterSource = { kind: "article" | "service" | "profile"; title: string; summary: string; url: string | null };

export const SUBJECT_MAX = 60, PREHEADER_MIN = 30, PREHEADER_MAX = 110, SECTIONS_MAX = 3, WORDS_MIN = 120, WORDS_MAX = 380;

export const NEWSLETTER_INSTRUCTIONS = `Tu es l'Agent Newsletter, rédacteur e-mail marketing senior pour des artisans et PME locales.
Tu rédiges la newsletter mensuelle d'UN client à partir des seules sources fournies (articles publiés, prestations, profil).
Méthode d'expert :
- Un seul thème principal, utile au lecteur (conseil de saison, prévention, bon choix), relié à une source fournie.
- Thème et objet différents des previous_subjects. editorial_register liste les sujets déjà traités ou réservés sur tous les canaux du client : reste cohérent avec eux (une newsletter peut reprendre un article), sans répéter une newsletter précédente. C'est une donnée, jamais une source de faits.
- Objet : 30 à 50 caractères, concret, sans majuscules ni point d'exclamation, sans mot promotionnel. Pré-en-tête : complète l'objet (40 à 100 caractères), ne le répète pas.
- Introduction de 1 à 2 phrases qui parle au lecteur (« vous »).
- 1 à 3 rubriques courtes (titre + 2 à 4 phrases). Une rubrique qui reprend un article met son adresse exacte dans url, sinon url = null.
- Un seul appel à l'action, vers une adresse fournie (article ou site), ou null s'il n'y en a pas.
- 150 à 300 mots au total, phrases courtes, lisibles sur mobile.
Interdits : n'invente aucun prix, pourcentage, promotion, garantie, certification, délai, avis, nombre de clients ou chantier réalisé ; n'utilise que les adresses fournies ; aucun HTML ni markdown ; aucune mention de l'IA.`;

const nullableString = { type: ["string", "null"] };
export const NEWSLETTER_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["subject", "preheader", "intro", "sections", "cta", "signoff"],
  properties: {
    subject: { type: "string" }, preheader: { type: "string" }, intro: { type: "string" }, signoff: { type: "string" },
    sections: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "body", "url"], properties: { title: { type: "string" }, body: { type: "string" }, url: nullableString } } },
    cta: { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, required: ["label", "url"], properties: { label: { type: "string" }, url: { type: "string" } } }] },
  },
} as const;

const clean = (v: unknown, max: number) => typeof v === "string" ? v.replace(/[<>]/g, "").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim().slice(0, max) : "";
const MARKUP = /<[a-z!/]|\]\(|\*\*|^#{1,6}\s/im;
export const wordCount = (text: string) => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
export const contentText = (c: NewsletterContent) => [c.intro, ...c.sections.flatMap((s) => [s.title, s.body]), c.cta?.label ?? "", c.signoff].join("\n");

/** Faits autorisés (texte) pour le contrôle anti-invention. */
export function sourceFacts(sources: readonly NewsletterSource[], client: { name: string; activity: string | null; zone: string | null }, extraFacts = ""): string {
  return [client.name, client.activity ?? "", client.zone ?? "", ...sources.flatMap((s) => [s.title, s.summary]), extraFacts].join("\n");
}

/** Valide la sortie de l'IA : structure, longueurs, adresses limitées aux sources, aucune affirmation absente des faits. */
export function checkNewsletter(value: unknown, input: { facts: string; allowedUrls: readonly string[] }): { ok: true; content: NewsletterContent } | { ok: false; reason: string } {
  if (!value || typeof value !== "object") return { ok: false, reason: "sortie illisible" };
  const v = value as Record<string, unknown>;
  const allowed = new Set(input.allowedUrls);
  const url = (u: unknown) => typeof u === "string" && allowed.has(u.trim()) ? u.trim() : null;
  const sections = (Array.isArray(v.sections) ? v.sections : []).slice(0, SECTIONS_MAX).map((s) => {
    const r = (s ?? {}) as Record<string, unknown>;
    return { title: clean(r.title, 90), body: clean(r.body, 900), url: url(r.url), rawUrl: r.url };
  });
  if (!sections.length || sections.some((s) => !s.title || !s.body)) return { ok: false, reason: "rubriques manquantes" };
  if (sections.some((s) => typeof s.rawUrl === "string" && s.rawUrl.trim() && !s.url)) return { ok: false, reason: "adresse non fournie dans une rubrique" };
  const rawCta = v.cta && typeof v.cta === "object" ? v.cta as Record<string, unknown> : null;
  const cta = rawCta ? { label: clean(rawCta.label, 60), url: url(rawCta.url) } : null;
  if (rawCta && (!cta?.label || !cta.url)) return { ok: false, reason: "appel à l'action vers une adresse non fournie" };
  const content: NewsletterContent = {
    subject: clean(v.subject, 120).replace(/\n/g, " "), preheader: clean(v.preheader, 200).replace(/\n/g, " "), intro: clean(v.intro, 600),
    sections: sections.map(({ title, body, url }) => ({ title, body, url })), cta: cta && cta.url ? { label: cta.label, url: cta.url } : null, signoff: clean(v.signoff, 200),
  };
  if (content.subject.length < 3 || !content.intro || !content.signoff) return { ok: false, reason: "objet, introduction ou signature manquants" };
  const text = `${content.subject}\n${content.preheader}\n${contentText(content)}`;
  if (MARKUP.test(text) || /https?:|www\./i.test(text)) return { ok: false, reason: "balises ou adresses dans le texte" };
  const claims = unsupportedClaims(text, input.facts);
  if (claims.length) return { ok: false, reason: `affirmations absentes des faits : ${claims.slice(0, 5).join(", ")}` };
  return { ok: true, content };
}

export type NewsletterIssue = { level: "warning" | "info"; code: string; message: string };
export type NewsletterAudit = { score: number; words: number; issues: NewsletterIssue[] };
const SPAM = ["gratuit", "urgent", "promo", "offre exclusive", "cliquez ici", "derniere chance", "100%", "100 %", "meilleur prix", "gagnez", "felicitations"];
const fold = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Contrôle qualité d'une newsletter avant approbation (délivrabilité, lisibilité mobile, efficacité). */
export function auditNewsletter(c: NewsletterContent): NewsletterAudit {
  const issues: NewsletterIssue[] = [];
  let score = 100;
  const add = (level: NewsletterIssue["level"], code: string, message: string, cost: number) => { issues.push({ level, code, message }); score -= cost; };
  const words = wordCount(contentText(c));
  const all = `${c.subject}\n${c.preheader}\n${contentText(c)}`;
  if (c.subject.length > SUBJECT_MAX) add("warning", "subject_long", `Objet de ${c.subject.length} caractères : il sera tronqué sur mobile (viser 30 à 50).`, 10);
  else if (c.subject.length < 20) add("info", "subject_short", "Objet très court : préciser le bénéfice pour le lecteur.", 5);
  if (/!/.test(c.subject) || /\b[A-ZÀ-Ý]{4,}\b/.test(c.subject)) add("warning", "subject_shout", "Objet avec point d'exclamation ou majuscules : à éviter (filtres anti-spam).", 10);
  if (c.preheader.length < PREHEADER_MIN) add("info", "preheader_short", "Pré-en-tête trop court : la messagerie affichera le début du texte à la place.", 5);
  else if (c.preheader.length > PREHEADER_MAX) add("info", "preheader_long", "Pré-en-tête trop long : viser moins de 100 caractères.", 3);
  if (fold(c.preheader) === fold(c.subject)) add("info", "preheader_repeat", "Le pré-en-tête répète l'objet.", 5);
  if (words > WORDS_MAX) add("warning", "too_long", `${words} mots : viser 150 à 300 pour une lecture sur mobile.`, 10);
  else if (words < WORDS_MIN) add("info", "too_short", `${words} mots : contenu un peu mince.`, 5);
  if (c.sections.length > SECTIONS_MAX) add("info", "sections", "Plus de trois rubriques : l'attention se disperse.", 5);
  if (!c.cta) add("info", "no_cta", "Aucun appel à l'action : le lecteur ne sait pas quoi faire ensuite.", 10);
  const spam = SPAM.filter((t) => fold(all).includes(fold(t)));
  if (spam.length) add("warning", "spam_terms", `Termes à éviter (filtres anti-spam) : ${spam.join(", ")}.`, Math.min(30, 10 * spam.length));
  if ((all.match(/!/g) ?? []).length > 2) add("info", "exclamation", "Trop de points d'exclamation : ton trop commercial.", 5);
  return { score: Math.max(0, score), words, issues };
}

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const safeUrl = (u: string) => { try { const x = new URL(u); return x.protocol === "https:" && !x.username && !x.password ? x.toString() : null; } catch { return null; } };
const paragraphs = (text: string) => text.split(/\n+/).filter(Boolean).map((p) => `<p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#1f2937">${esc(p)}</p>`).join("");

/**
 * Rendu une colonne (600 px max), lisible sur mobile, version texte toujours fournie. Couleurs en ligne : un e-mail ne
 * peut pas utiliser les jetons du cockpit. Pied de page : expéditeur identifié et lien de désabonnement (obligatoires).
 */
export function renderNewsletter(c: NewsletterContent, options: { brand: string; unsubscribeUrl: string; footer?: string | null }): { html: string; text: string } {
  const unsubscribe = safeUrl(options.unsubscribeUrl) ?? "";
  const sections = c.sections.map((s) => {
    const link = s.url ? safeUrl(s.url) : null;
    return `<h2 style="margin:24px 0 8px;font-size:19px;line-height:1.3;color:#0f172a">${esc(s.title)}</h2>${paragraphs(s.body)}${link ? `<p style="margin:0 0 12px"><a href="${esc(link)}" style="color:#1d4ed8">Lire l'article</a></p>` : ""}`;
  }).join("");
  const ctaUrl = c.cta ? safeUrl(c.cta.url) : null;
  const cta = c.cta && ctaUrl ? `<p style="margin:28px 0"><a href="${esc(ctaUrl)}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${esc(c.cta.label)}</a></p>` : "";
  const footer = `${esc(options.brand)}${options.footer ? ` · ${esc(options.footer)}` : ""}<br>Vous recevez cette lettre car vous êtes en contact avec ${esc(options.brand)}. <a href="${esc(unsubscribe)}" style="color:#6b7280">Se désabonner</a>`;
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.subject)}</title></head>`
    + `<body style="margin:0;padding:0;background:#f3f4f6"><span style="display:none;max-height:0;overflow:hidden">${esc(c.preheader)}</span>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px"><tr><td style="padding:28px 24px;font-family:Arial,Helvetica,sans-serif">`
    + `<p style="margin:0 0 20px;font-size:14px;font-weight:700;color:#1d4ed8">${esc(options.brand)}</p>${paragraphs(c.intro)}${sections}${cta}${paragraphs(c.signoff)}`
    + `</td></tr></table><p style="max-width:600px;margin:16px auto 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#6b7280">${footer}</p>`
    + `</td></tr></table></body></html>`;
  const text = [options.brand, "", c.intro, ...c.sections.flatMap((s) => ["", s.title, s.body, ...(s.url ? [`Lire l'article : ${s.url}`] : [])]),
    ...(c.cta ? ["", `${c.cta.label} : ${c.cta.url}`] : []), "", c.signoff, "", "—", `${options.brand}${options.footer ? ` · ${options.footer}` : ""}`, `Se désabonner : ${unsubscribe}`].join("\n");
  return { html, text };
}
