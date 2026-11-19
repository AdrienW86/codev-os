import { OPT_OUT_FOOTER, auditOutreachDraft } from "./outreach";
import type { VerifiedFact } from "./draft-generator";

// Agent Rédacteur prospection (fonctions pures) : un premier message propre à l'entreprise ciblée, écrit à partir des
// SEULS faits vérifiés (registre, page publique de l'entreprise, fiche du client). Toute sortie qui cite un fait
// absent, un chiffre inconnu, un lien, ou qui rate le contrôle qualité est refusée : le modèle de base reste alors.

export type WriterFact = VerifiedFact & { id: string };

const text = (value: string, max: number) => value.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, "\"")
  .replace(/\s+/g, " ").trim().slice(0, max);

/** Faits publiés par l'entreprise sur sa page (titre, description, titre principal), avec l'adresse de la page. */
export function extractPageFacts(html: string, url: string, verifiedAt: string): WriterFact[] {
  const facts: WriterFact[] = [];
  const add = (id: string, label: string, raw: string | undefined) => {
    const statement = raw ? text(raw, 220) : "";
    if (statement.length >= 12 && !facts.some((f) => f.statement === statement)) facts.push({ id, label, statement, sourceUrl: url, verifiedAt });
  };
  add("site_title", "Titre de son site", /<title[^>]*>([\s\S]{0,400}?)<\/title>/i.exec(html)?.[1]);
  add("site_description", "Présentation sur son site", /<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']{0,500})["']/i.exec(html)?.[1]
    ?? /<meta\s+[^>]*content=["']([^"']{0,500})["'][^>]*name=["']description["']/i.exec(html)?.[1]);
  add("site_heading", "Titre principal de son site", /<h1[^>]*>([\s\S]{0,400}?)<\/h1>/i.exec(html)?.[1]);
  return facts;
}

export const WRITER_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["refused", "refusal_reason", "subject", "body", "fact_ids_used"],
  properties: {
    refused: { type: "boolean" }, refusal_reason: { type: "string" },
    subject: { type: "string" }, body: { type: "string" },
    fact_ids_used: { type: "array", items: { type: "string" } },
  },
} as const;

export const WRITER_INSTRUCTIONS = `Tu rédiges un PREMIER e-mail de prospection B2B, en français, d'un professionnel (sender) à une entreprise (recipient).
Règles impératives :
- N'utilise QUE les faits fournis (facts, sender, recipient). N'invente rien : aucun chiffre, délai, prix, garantie, référence, client, chantier, nom de personne.
- Cite au moins un fait propre au destinataire (facts) et indique ses identifiants dans fact_ids_used.
- Objet : 45 caractères au plus, sans majuscules criardes ni point d'exclamation, avec le nom du destinataire ou un fait précis.
- Corps : 60 à 110 mots, vouvoiement, ton sobre et direct. Commence par « Bonjour, ». Une raison concrète de prendre contact liée au destinataire, l'intérêt pour lui (benefit), une proposition de recommandation mutuelle si pertinent, puis UNE question simple à faible engagement (ex. 10 minutes d'échange). Signe avec sender.name.
- Aucun lien, aucune adresse e-mail, aucun numéro de téléphone, aucune pièce jointe, aucun mot commercial agressif (gratuit, urgent, offre, promo, garanti).
- N'ajoute PAS de mention de désinscription : elle est ajoutée automatiquement.
- Si les faits ne permettent pas d'écrire un message honnête et personnalisé, mets refused=true avec la raison, et des chaînes vides.`;

export type WriterContext = {
  sender: { name: string; activity: string | null; zone: string | null };
  recipient: { company: string; city: string | null; segment: string | null };
  benefit: string;
  facts: WriterFact[];
};

export function writerInput(ctx: WriterContext): string {
  return JSON.stringify({ sender: ctx.sender, recipient: ctx.recipient, benefit: ctx.benefit, facts: ctx.facts.map((f) => ({ id: f.id, label: f.label, statement: f.statement })) });
}

const fold = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const words = (v: string) => v.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

export type WriterVerdict =
  | { ok: true; subject: string; body: string; facts: WriterFact[] }
  | { ok: false; reason: string };

/** Contrôle de la sortie du modèle avant de remplacer le brouillon. */
export function validateWriterOutput(raw: unknown, ctx: WriterContext): WriterVerdict {
  const out = raw as { refused?: unknown; subject?: unknown; body?: unknown; fact_ids_used?: unknown } | null;
  if (!out || out.refused === true) return { ok: false, reason: "refused" };
  if (typeof out.subject !== "string" || typeof out.body !== "string" || !Array.isArray(out.fact_ids_used)) return { ok: false, reason: "malformed" };
  const subject = out.subject.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  const body = out.body.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const used = ctx.facts.filter((f) => (out.fact_ids_used as unknown[]).includes(f.id));
  if (!used.length || (out.fact_ids_used as unknown[]).some((id) => !ctx.facts.some((f) => f.id === id))) return { ok: false, reason: "facts" };
  if (!subject || subject.length > 60 || words(body) < 40 || words(body) > 130) return { ok: false, reason: "length" };
  if (/https?:\/\/|www\.|@|<[a-z/]|\*\*/i.test(`${subject}\n${body}`)) return { ok: false, reason: "links" };
  if (!fold(`${subject} ${body}`).includes(fold(ctx.recipient.company).slice(0, 40))) return { ok: false, reason: "not_personal" };
  // Aucun nombre absent des données fournies (délais, prix, années, effectifs inventés).
  const known = fold(JSON.stringify(ctx));
  const numbers = `${subject} ${body}`.match(/\d+(?:[.,]\d+)?/g) ?? [];
  if (numbers.some((n) => n !== "10" && !known.includes(n))) return { ok: false, reason: "invented_number" };
  const draftBody = `${body}\n\n${OPT_OUT_FOOTER}`;
  const audit = auditOutreachDraft({ subject, body: draftBody }, ctx.recipient.company);
  if (audit.score < 70 || audit.issues.some((i) => ["placeholder", "spam_terms", "links", "subject_empty"].includes(i.code))) return { ok: false, reason: "quality" };
  return { ok: true, subject, body: draftBody, facts: used };
}
