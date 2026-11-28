// Agent Leads (fonctions pures, aucun accès réseau ni base) : lecture d'une demande de devis, qualification par règles,
// contrôle de la qualification et de la réponse proposées par l'IA, réponses et relances de repli, calendrier des relances.
// Règle du harness : rien n'est inventé. Une réponse ne contient ni prix, ni délai, ni garantie, ni lien qui ne figure pas
// dans les faits confirmés du client, ses réglages ou la demande elle-même ; sinon le modèle de repli est utilisé.
import { createHash } from "node:crypto";
import { z } from "zod";

export const LEAD_STATES = ["new", "ready", "contacted", "answered", "won", "lost", "closed", "spam"] as const;
export type LeadState = (typeof LEAD_STATES)[number];
export const LEAD_STATE_LABELS: Record<LeadState, string> = {
  new: "Reçue", ready: "Réponse à valider", contacted: "Répondu, en attente du prospect", answered: "Le prospect a répondu",
  won: "Gagnée", lost: "Perdue", closed: "Sans réponse (close)", spam: "Indésirable",
};
/** États où la demande attend encore quelque chose de l'agent ou de l'administrateur. */
export const OPEN_STATES: readonly LeadState[] = ["new", "ready", "contacted", "answered"];
/** États qu'un administrateur peut choisir à la main. */
export const MANUAL_STATES: readonly LeadState[] = ["answered", "won", "lost", "closed", "spam"];
export const isLeadState = (value: unknown): value is LeadState => typeof value === "string" && (LEAD_STATES as readonly string[]).includes(value);

export type LeadSource = "form" | "email" | "manual";
export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = { form: "Formulaire du site", email: "E-mail", manual: "Saisie manuelle" };
export type Urgency = "urgent" | "soon" | "flexible" | "unknown";
export const URGENCY_LABELS: Record<Urgency, string> = { urgent: "Urgent", soon: "Sous quelques semaines", flexible: "Sans urgence", unknown: "Non précisé" };
export type Score = "hot" | "warm" | "cold";
export const SCORE_LABELS: Record<Score, string> = { hot: "Chaude", warm: "Tiède", cold: "Froide" };

export const MAX_FOLLOWUPS = 2;
/** Délai de chaque relance après le dernier envoi, en jours ouvrés. */
export const FOLLOWUP_BUSINESS_DAYS: readonly number[] = [2, 3];
/** Après la dernière relance sans réponse, la demande est close au bout de ce nombre de jours. */
export const CLOSE_AFTER_DAYS = 7;
/** Conservation des demandes (CNIL, prospects) : 3 ans après le dernier échange. */
export const RETENTION_DAYS = 3 * 365;

// --- Lecture d'une demande ------------------------------------------------------------------------------------------

const EMAIL = /^[^\s@<>()",;:]{1,64}@[^\s@<>()",;:]{1,253}\.[a-z]{2,}$/i;
const clean = (value: unknown, max: number) => typeof value === "string" ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max) : "";
const oneLine = (value: unknown, max: number) => clean(value, max * 2).replace(/\s+/g, " ").slice(0, max);

export function normalizeLeadEmail(value: unknown): string | null {
  const text = oneLine(value, 254).toLowerCase().replace(/^mailto:/, "");
  return EMAIL.test(text) ? text : null;
}

/** Téléphone français (10 chiffres, ou +33) ou international (+ et 8 à 15 chiffres) ; null sinon. */
export function normalizePhone(value: unknown): string | null {
  const raw = oneLine(value, 40);
  if (!raw) return null;
  const digits = raw.replace(/[\s.\-()/]/g, "");
  if (/^0[1-9]\d{8}$/.test(digits)) return digits.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
  if (/^(\+|00)33[1-9]\d{8}$/.test(digits)) return `0${digits.slice(-9)}`.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
  if (/^\+[1-9]\d{7,14}$/.test(digits)) return digits;
  return null;
}

export type LeadSubmission = {
  name: string | null; email: string | null; phone: string | null; postcode: string | null; city: string | null;
  subject: string | null; message: string; pageUrl: string | null;
};

/** Champs reconnus d'un formulaire (noms courants des formulaires de sites, français ou anglais). */
const pick = (raw: Record<string, unknown>, names: readonly string[]) => { for (const name of names) if (raw[name] !== undefined && raw[name] !== null && raw[name] !== "") return raw[name]; return undefined; };
const FIELDS = {
  name: ["name", "nom", "fullname", "full_name", "prenom_nom", "your-name"],
  firstName: ["prenom", "firstname", "first_name"], lastName: ["lastname", "last_name", "nom_famille"],
  email: ["email", "mail", "e-mail", "courriel", "your-email"], phone: ["phone", "telephone", "tel", "téléphone", "mobile", "your-phone"],
  postcode: ["postcode", "code_postal", "cp", "zip", "postal_code"], city: ["city", "ville", "commune"],
  subject: ["subject", "objet", "sujet", "service", "prestation", "your-subject"], message: ["message", "demande", "description", "details", "projet", "comments", "your-message"],
  page: ["page_url", "page", "url", "source_url"],
} as const;
/** Pièges à robots (champ invisible rempli = robot). */
export const HONEYPOT_FIELDS = ["website", "_gotcha", "hp", "url_site"] as const;

export type SubmissionResult = { ok: true; value: LeadSubmission } | { ok: false; reason: "honeypot" | "invalid"; message: string };

export function readSubmission(raw: unknown): SubmissionResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "invalid", message: "Demande illisible." };
  const data = raw as Record<string, unknown>;
  if (HONEYPOT_FIELDS.some((name) => typeof data[name] === "string" && (data[name] as string).trim() !== "")) return { ok: false, reason: "honeypot", message: "Demande refusée." };
  const first = oneLine(pick(data, FIELDS.firstName), 60), last = oneLine(pick(data, FIELDS.lastName), 60);
  const name = oneLine(pick(data, FIELDS.name), 120) || [first, last].filter(Boolean).join(" ") || null;
  const email = normalizeLeadEmail(pick(data, FIELDS.email));
  const phone = normalizePhone(pick(data, FIELDS.phone));
  const postcodeRaw = oneLine(pick(data, FIELDS.postcode), 10).replace(/\s/g, "");
  const message = clean(pick(data, FIELDS.message), 5000).replace(/\r\n/g, "\n").replace(/\n{4,}/g, "\n\n\n");
  if (message.length < 5) return { ok: false, reason: "invalid", message: "Message manquant." };
  if (!email && !phone) return { ok: false, reason: "invalid", message: "Une adresse e-mail ou un téléphone valide est nécessaire pour vous répondre." };
  const page = oneLine(pick(data, FIELDS.page), 500);
  return { ok: true, value: {
    name: name && !/[<>]/.test(name) ? name : null, email, phone,
    postcode: /^\d{5}$/.test(postcodeRaw) ? postcodeRaw : null, city: oneLine(pick(data, FIELDS.city), 120) || null,
    subject: oneLine(pick(data, FIELDS.subject), 300) || null, message,
    pageUrl: /^https?:\/\/[^\s<>"]+$/i.test(page) ? page : null,
  } };
}

/** Empreinte d'une demande : la même personne qui renvoie le même message n'est enregistrée qu'une fois. */
export function leadFingerprint(clientId: string, submission: Pick<LeadSubmission, "email" | "phone" | "message">): string {
  const message = submission.message.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update([clientId, submission.email ?? "", submission.phone ?? "", message].join("\u0001")).digest("hex");
}

/** Empreinte d'une adresse IP (HMAC) : la limite de débit fonctionne sans jamais conserver l'adresse. */
export function ipFingerprint(ip: string | null, secret: string): string | null {
  const value = (ip ?? "").split(",")[0].trim();
  if (!value || value.length > 64) return null;
  return createHash("sha256").update(`${secret}\u0001${value}`).digest("hex").slice(0, 40);
}

/** Origine autorisée d'un formulaire : https, sans chemin. */
export function normalizeOrigin(value: unknown): string | null {
  const text = oneLine(value, 200).toLowerCase().replace(/\/+$/, "");
  return /^https:\/\/([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(text) ? text : null;
}

// --- Indésirables ---------------------------------------------------------------------------------------------------

const SPAM_WORDS = /\b(backlinks?|seo (services?|agency|expert)|guest post|casino|crypto(currency)?|bitcoin|viagra|cialis|loan offer|forex|porn|escort|web ?design services|rank (your|on) google|increase (your )?traffic|first page of google|whatsapp me|telegram me)\b/i;

/** Indésirable évident (règles) : plusieurs liens, écriture non latine dominante, vocabulaire de spam connu. */
export function obviousSpam(submission: Pick<LeadSubmission, "message" | "subject" | "name">): boolean {
  const text = `${submission.subject ?? ""} ${submission.message} ${submission.name ?? ""}`;
  const links = (text.match(/https?:\/\/|www\./gi) ?? []).length;
  const letters = text.replace(/[^\p{L}]/gu, "");
  const latin = letters.replace(/[^\p{Script=Latin}]/gu, "");
  return links >= 3 || SPAM_WORDS.test(text) || (letters.length > 20 && latin.length / letters.length < 0.6) || /<a\s+href|\[url=/i.test(text);
}

// --- Qualification par règles (repli, et contrôle de l'IA) ---------------------------------------------------------

export const fold = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, " ").replace(/[^a-z0-9@.+\s-]/g, " ").replace(/\s+/g, " ").trim();
const URGENT = /\b(urgent|urgence|en urgence|fuite|fuit|infiltration|degat des eaux|inond|sinistre|tempete|arrache|effondr|plus de chauffage|plus d eau chaude|panne|bloque|des que possible|au plus vite|aujourd hui|ce soir|demain)\b/;
const SOON = /\b(rapidement|dans les prochains jours|cette semaine|semaine prochaine|ce mois|dans le mois|avant (l ete|l hiver|la fin)|d ici (\d+|quelques) (jours|semaines))\b/;
const FLEXIBLE = /\b(pas urgent|sans urgence|pas presse|dans l annee|l an prochain|annee prochaine|plus tard|me renseigner|simple renseignement|projet futur|a terme)\b/;

const STOPWORDS = new Set(["de", "des", "du", "la", "le", "les", "et", "en", "pour", "sur", "un", "une", "a", "au", "aux", "d", "l", "par", "avec", "travaux", "service", "services", "prestation", "renovation"]);
const stems = (text: string) => fold(text).split(" ").filter((w) => w.length >= 4 && !STOPWORDS.has(w)).map((w) => w.slice(0, 6));

/** Prestation confirmée du client la plus proche du texte de la demande (au moins un mot significatif commun). */
export function matchService(text: string, services: readonly string[]): string | null {
  const words = new Set(stems(text));
  let best: { service: string; score: number } | null = null;
  for (const service of services) {
    const own = stems(service);
    const score = own.filter((w) => words.has(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { service, score };
  }
  return best?.service ?? null;
}

export type Qualification = {
  spam: boolean; service: string | null; urgency: Urgency; score: Score; summary: string;
  timeframe: string | null; budget: string | null; property: string | null; location: string | null;
  missing: string[]; questions: string[]; evidence: string[];
};

const MISSING_QUESTIONS: Record<string, string> = {
  location: "l’adresse ou au moins la commune du chantier",
  details: "quelques précisions sur les travaux souhaités (dimensions, surface ou quantité)",
  timeframe: "le délai souhaité pour l’intervention",
  photos: "si possible, une ou deux photos de l’existant",
  phone: "un numéro de téléphone pour vous rappeler",
};

/** Qualification déterministe : utilisée sans IA, quand l'IA échoue, ou quand sa sortie ne passe pas le contrôle. */
export function ruleQualification(submission: LeadSubmission, services: readonly string[]): Qualification {
  const text = fold(`${submission.subject ?? ""} ${submission.message}`);
  // « pas urgent », « sans urgence » ne comptent jamais comme une urgence.
  const unhurried = text.replace(/\b(pas|rien d|sans) (urgent|urgence|presse)\b/g, " ");
  const urgency: Urgency = URGENT.test(unhurried) ? "urgent" : SOON.test(unhurried) ? "soon" : FLEXIBLE.test(text) ? "flexible" : "unknown";
  const service = matchService(`${submission.subject ?? ""} ${submission.message}`, services);
  const location = submission.postcode || submission.city ? [submission.postcode, submission.city].filter(Boolean).join(" ") : null;
  const missing: string[] = [];
  if (!location && !/\b\d{5}\b/.test(submission.message)) missing.push("location");
  if (submission.message.length < 80) missing.push("details");
  if (urgency === "unknown") missing.push("timeframe");
  if (!submission.phone) missing.push("phone");
  if (missing.length < 3) missing.push("photos");
  const score: Score = urgency === "urgent" || (service && submission.phone && urgency === "soon") ? "hot" : service || urgency === "soon" ? "warm" : "cold";
  return {
    spam: obviousSpam(submission), service, urgency, score,
    summary: (submission.subject ? `${submission.subject} : ` : "") + submission.message.replace(/\s+/g, " ").slice(0, 220),
    timeframe: null, budget: null, property: null, location,
    missing: missing.slice(0, 4), questions: missing.slice(0, 3).map((m) => MISSING_QUESTIONS[m]).filter(Boolean), evidence: [],
  };
}

// --- Sortie de l'IA : qualification + première réponse --------------------------------------------------------------

export const LEAD_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["spam", "service", "urgency", "score", "summary", "timeframe", "budget", "property", "location", "missing", "questions", "evidence", "reply_subject", "reply_body"],
  properties: {
    spam: { type: "boolean" },
    service: { type: ["string", "null"] },
    urgency: { type: "string", enum: ["urgent", "soon", "flexible", "unknown"] },
    score: { type: "string", enum: ["hot", "warm", "cold"] },
    summary: { type: "string" },
    timeframe: { type: ["string", "null"] }, budget: { type: ["string", "null"] }, property: { type: ["string", "null"] }, location: { type: ["string", "null"] },
    missing: { type: "array", items: { type: "string" } },
    questions: { type: "array", items: { type: "string" } },
    evidence: { type: "array", items: { type: "string" } },
    reply_subject: { type: "string" },
    reply_body: { type: "string" },
  },
} as const;

export const LEAD_INSTRUCTIONS = [
  "Tu reçois une demande de devis adressée à une entreprise artisanale (champ request_untrusted) et les faits confirmés de cette entreprise.",
  "1. Qualifie la demande : spam (true seulement pour une sollicitation commerciale, un robot ou un message sans rapport avec un besoin de travaux) ; service = une prestation de la liste services recopiée à l’identique, ou null si aucune ne correspond ; urgency ; score (hot : besoin clair, urgent ou rapide, joignable ; warm : besoin plausible à préciser ; cold : simple renseignement ou hors activité) ; summary en une phrase factuelle ; timeframe, budget, property (type de bien), location : recopiés de la demande, sinon null.",
  "evidence : 1 à 4 courtes citations exactes (mot pour mot) de la demande qui justifient ta qualification. missing : informations utiles au devis absentes de la demande. questions : au plus 3 questions simples pour les obtenir.",
  "2. Rédige la première réponse au prospect, au nom de l’entreprise, en français, vouvoiement, 60 à 140 mots : remerciement, reformulation courte du besoin, les questions, puis la formule de rappel.",
  "La réponse ne contient AUCUN prix, tarif, délai, date, garantie, certification, avis, lien ou numéro qui ne figure pas mot pour mot dans les faits (facts_untrusted), les réglages (callback_promise, phone, signature) ou la demande. Pas de « devis gratuit » sauf s’il figure dans les faits.",
  "Formule de rappel : si callback_promise est fourni, dis que l’entreprise recontacte le prospect avec exactement ces mots ; sinon dis seulement que la demande est bien reçue et qu’elle sera étudiée.",
  "Si service est null ou si la demande semble hors activité, la réponse reste polie et neutre : tu ne promets pas que l’entreprise réalise ces travaux.",
  "Termine par la signature fournie (signature, sinon le nom de l’entreprise). Pas de formule toute faite (« n’hésitez pas », « nous restons à votre disposition »), pas d’emoji, pas de markdown.",
].join("\n");

const LIMIT = { summary: 300, field: 120, subject: 120, body: 1400 } as const;
const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
const nullable = (value: unknown, max: number) => text(value, max) || null;

/** Recherche « mot pour mot » tolérante (casse, accents, ponctuation). */
export const containsLoosely = (haystack: string, needle: string) => { const n = fold(needle); return n.length >= 3 && fold(haystack).includes(n); };

/** Qualification proposée par l'IA, recalée sur les règles : prestation hors liste refusée, citations introuvables retirées. */
export function checkQualification(value: unknown, input: { submission: LeadSubmission; services: readonly string[] }): Qualification | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const urgency = ["urgent", "soon", "flexible", "unknown"].includes(v.urgency as string) ? v.urgency as Urgency : null;
  const score = ["hot", "warm", "cold"].includes(v.score as string) ? v.score as Score : null;
  if (!urgency || !score || typeof v.spam !== "boolean") return null;
  const source = `${input.submission.subject ?? ""}\n${input.submission.message}\n${input.submission.city ?? ""} ${input.submission.postcode ?? ""}`;
  const service = typeof v.service === "string" ? input.services.find((s) => fold(s) === fold(v.service as string)) ?? null : null;
  const quoted = (field: unknown, max: number) => { const t = nullable(field, max); return t && containsLoosely(source, t) ? t : null; };
  const list = (field: unknown, max: number, count: number) => Array.isArray(field) ? field.map((x) => text(x, max)).filter(Boolean).slice(0, count) : [];
  const evidence = list(v.evidence, 200, 4).filter((quote) => containsLoosely(source, quote));
  const summary = text(v.summary, LIMIT.summary);
  if (!summary) return null;
  return {
    spam: v.spam, service, urgency, score, summary,
    timeframe: quoted(v.timeframe, LIMIT.field), budget: quoted(v.budget, LIMIT.field), property: quoted(v.property, LIMIT.field), location: quoted(v.location, LIMIT.field),
    missing: list(v.missing, 160, 5), questions: list(v.questions, 200, 3), evidence,
  };
}

export type ReplyContext = {
  clientName: string; facts: string; exclusions: readonly string[];
  callbackPromise: string | null; phone: string | null; signature: string | null;
};

const PROMISES = /\b(gratuit\w*|garanti\w*|certifi\w*|label\w*|rge|qualibat|assur\w* decennale|decennale|meilleur prix|moins cher|devis sous|intervention sous|sous \d+|en \d+ ?(h|heures?|jours?|minutes?)|dans (l|les) (heure|journee)|24 ?h|48 ?h|7 ?j(ours)?\/7|remise|promotion|offert\w*|satisfait ou rembours\w*)\b/;
const CLICHES = /\b(n hesitez pas|restons a votre (entiere )?disposition|nous sommes ravis|au plaisir de|cordialement votre)\b/;

export type ReplyCheck = { ok: true; subject: string; body: string } | { ok: false; reason: string };

/**
 * Contrôle d'une réponse avant enregistrement : chaque chiffre, lien, adresse ou promesse commerciale doit figurer dans
 * les faits du client, ses réglages ou la demande ; aucune exclusion du client ; longueur raisonnable.
 */
export function checkReply(subjectRaw: unknown, bodyRaw: unknown, input: { context: ReplyContext; submission: LeadSubmission }): ReplyCheck {
  const subject = text(subjectRaw, LIMIT.subject);
  const body = typeof bodyRaw === "string" ? bodyRaw.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, LIMIT.body) : "";
  if (subject.length < 3) return { ok: false, reason: "objet manquant" };
  const words = body.split(/\s+/).filter(Boolean).length;
  if (words < 25 || words > 220) return { ok: false, reason: `longueur hors cadre (${words} mots)` };
  const { context, submission } = input;
  const allowed = [context.facts, context.callbackPromise ?? "", context.phone ?? "", context.signature ?? "", context.clientName, submission.message, submission.subject ?? "", submission.name ?? "", submission.city ?? "", submission.postcode ?? ""].join("\n");
  const allowedFold = fold(allowed), allowedDigits = allowed.replace(/\D+/g, " ");
  for (const number of `${subject}\n${body}`.match(/\d[\d\s.,]*\d|\d/g) ?? []) {
    const digits = number.replace(/\D/g, "");
    if (digits && !allowedDigits.includes(digits) && !allowed.replace(/\D/g, "").includes(digits)) return { ok: false, reason: `chiffre non confirmé (${number.trim()})` };
  }
  if (/https?:\/\/|www\.|@/.test(body) && !(body.match(/(https?:\/\/\S+|www\.\S+|\S+@\S+)/g) ?? []).every((token) => allowed.toLowerCase().includes(token.replace(/[.,;:!?)]+$/, "").toLowerCase()))) return { ok: false, reason: "lien ou adresse non confirmés" };
  if (/€|\beuros?\b|%/i.test(body) && !/€|\beuros?\b|%/i.test(context.facts)) return { ok: false, reason: "montant non confirmé" };
  const foldedBody = fold(`${subject} ${body}`);
  for (const match of foldedBody.match(new RegExp(PROMISES.source, "g")) ?? []) if (!allowedFold.includes(match)) return { ok: false, reason: `promesse non confirmée (« ${match} »)` };
  if (CLICHES.test(foldedBody)) return { ok: false, reason: "formule toute faite" };
  for (const exclusion of context.exclusions) if (exclusion.trim().length >= 3 && containsLoosely(body, exclusion)) return { ok: false, reason: "mention exclue par le client" };
  if (/[*#`_]{2,}|^\s*[-*]\s/m.test(body) && /\*\*|##|`/.test(body)) return { ok: false, reason: "mise en forme markdown" };
  return { ok: true, subject, body };
}

const greeting = (name: string | null) => {
  const first = name?.trim().split(/\s+/).length === 1 ? null : name?.trim();
  return first ? `Bonjour ${first},` : "Bonjour,";
};
const signatureOf = (context: ReplyContext) => [context.signature?.trim() || context.clientName, context.phone ? `Tél. ${context.phone}` : ""].filter(Boolean).join("\n");

/** Première réponse de repli (aucune IA) : accusé de réception, questions utiles, rappel confirmé seulement s'il existe. */
export function templateReply(submission: LeadSubmission, qualification: Qualification, context: ReplyContext): { subject: string; body: string } {
  const about = qualification.service ? ` concernant ${qualification.service.toLowerCase()}` : "";
  const callback = context.callbackPromise ? `Nous vous recontactons ${context.callbackPromise.replace(/\.$/, "")}.` : "Nous l’étudions et revenons vers vous.";
  const asked = qualification.questions.map((q) => q.replace(/[\s.;?]+$/, ""));
  const questions = asked.length ? ["Pour préparer au mieux notre réponse, pourriez-vous nous indiquer :", ...asked.map((q, i) => `- ${q}${i === asked.length - 1 ? "." : " ;"}`)].join("\n") : "";
  return {
    subject: `Votre demande${about ? ` : ${qualification.service}` : ""} – ${context.clientName}`.slice(0, 120),
    body: [greeting(submission.name), "", `Merci pour votre demande${about}, nous l’avons bien reçue. ${callback}`, ...(questions ? ["", questions] : []), "", "Bien à vous,", signatureOf(context)].join("\n"),
  };
}

/** Relance de repli (rang 1 ou 2) : courte, sans pression, rappelle la demande. */
export function followupReply(step: number, lead: { name: string | null; service: string | null; receivedAt: string; questions: readonly string[] }, context: ReplyContext): { subject: string; body: string } {
  const date = new Date(lead.receivedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "Europe/Paris" });
  const about = lead.service ? ` de ${lead.service.toLowerCase()}` : "";
  const lines = step === 1
    ? [`Je reviens vers vous au sujet de votre demande${about} du ${date}.`, lead.questions.length ? `Pour avancer, il nous manque encore ${lead.questions[0].replace(/[.;]$/, "")}.` : "Votre projet est-il toujours d’actualité ?", "Une réponse rapide à ce message suffit, nous nous occupons du reste."]
    : [`Dernier message de notre part au sujet de votre demande${about} du ${date}.`, "Si votre projet est toujours d’actualité, répondez simplement à ce message et nous reprenons contact avec vous. Sinon, nous clôturons votre demande."];
  return {
    subject: `${step === 1 ? "Votre demande" : "Dernière relance : votre demande"}${lead.service ? ` (${lead.service})` : ""} – ${context.clientName}`.slice(0, 120),
    body: [greeting(lead.name), "", ...lines, "", "Bien à vous,", signatureOf(context)].join("\n"),
  };
}

/** Mention de transparence ajoutée sous chaque message envoyé au demandeur (origine du contact, opposition). */
export const transparencyFooter = (clientName: string, receivedAt: string) =>
  `—\nVous recevez ce message car vous avez adressé une demande à ${clientName} le ${new Date(receivedAt).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}. Répondez « STOP » pour ne plus être recontacté.`;

/** Résumé envoyé à l'artisan pour une nouvelle demande. */
export function notifyText(lead: { name: string | null; email: string | null; phone: string | null; location: string | null; message: string; source: LeadSource }, qualification: Qualification, link: string | null): { subject: string; text: string } {
  const flag = qualification.urgency === "urgent" ? "URGENT – " : "";
  return {
    subject: `${flag}Nouvelle demande${qualification.service ? ` : ${qualification.service}` : ""}${lead.location ? ` (${lead.location})` : ""}`.slice(0, 160),
    text: [
      `Nouvelle demande reçue (${LEAD_SOURCE_LABELS[lead.source].toLowerCase()}).`, "",
      `Nom : ${lead.name ?? "non précisé"}`, `Téléphone : ${lead.phone ?? "non précisé"}`, `E-mail : ${lead.email ?? "non précisé"}`, `Lieu : ${lead.location ?? "non précisé"}`,
      `Urgence : ${URGENCY_LABELS[qualification.urgency]} · Intérêt : ${SCORE_LABELS[qualification.score]}`, "",
      "Message :", lead.message.slice(0, 3000), "",
      qualification.missing.length ? `À préciser : ${qualification.questions.join(" ; ") || qualification.missing.join(", ")}` : "",
      link ? `Suivi : ${link}` : "",
    ].filter((line, i, all) => line !== "" || all[i - 1] !== "").join("\n").trim(),
  };
}

// --- Calendrier -----------------------------------------------------------------------------------------------------

const PARIS = "Europe/Paris";
function parisParts(date: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: PARIS, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(date).map((p) => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute), weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday) };
}
/** Instant UTC d'une heure locale de Paris (gère l'heure d'été). */
function parisTime(year: number, month: number, day: number, hour: number): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour));
  const seen = parisParts(guess);
  const drift = (Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour) - guess.getTime());
  return new Date(guess.getTime() - drift);
}

/** Échéance d'une relance : N jours ouvrés (lundi-vendredi) après la date donnée, à 10 h (Paris). */
export function followupDueAt(from: Date, businessDays: number): Date {
  let { year, month, day } = parisParts(from);
  let added = 0;
  while (added < businessDays) {
    const next = new Date(Date.UTC(year, month - 1, day + 1, 12));
    year = next.getUTCFullYear(); month = next.getUTCMonth() + 1; day = next.getUTCDate();
    const weekday = next.getUTCDay();
    if (weekday !== 0 && weekday !== 6) added++;
  }
  return parisTime(year, month, day, 10);
}

/** Relances envoyées du lundi au samedi, de 9 h à 19 h (Paris) ; jamais la nuit ni le dimanche. */
export function followupWindowOpen(now: Date): boolean {
  const p = parisParts(now);
  return p.weekday !== 0 && p.hour >= 9 && p.hour < 19;
}

/** Échéance de la relance suivante après un envoi de rang `step` (0 = première réponse), ou null s'il n'y en a plus. */
export function nextFollowup(sentAt: Date, step: number, followups: number): Date | null {
  return step < Math.min(followups, MAX_FOLLOWUPS) ? followupDueAt(sentAt, FOLLOWUP_BUSINESS_DAYS[step] ?? 3) : null;
}

// --- Adresse de réception (e-mails transférés et réponses des prospects) -------------------------------------------

export const INBOUND_PREFIX = "devis-";
/** Adresse de réception du client sur le domaine entrant (LEADS_INBOUND_DOMAIN) : devis-<16 premiers caractères de la clé>. */
export function inboundAddress(formKey: string, domain: string | null | undefined): string | null {
  const d = (domain ?? "").trim().toLowerCase();
  if (!d || !/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d) || !/^[a-f0-9]{32}$/.test(formKey)) return null;
  return `${INBOUND_PREFIX}${formKey.slice(0, 16)}@${d}`;
}
/** Préfixe de clé lu dans une adresse de réception, ou null si l'adresse n'est pas celle de l'Agent Leads. */
export function inboundKeyPrefix(address: string, domain: string | null | undefined): string | null {
  const d = (domain ?? "").trim().toLowerCase();
  const match = d ? address.toLowerCase().match(/^devis-([a-f0-9]{16})@(.+)$/) : null;
  return match && match[2] === d ? match[1] : null;
}

/** Coordonnées d'un demandeur dans un e-mail transféré par l'artisan (première adresse et premier téléphone qui ne sont pas les siens). */
export function contactFromForwarded(body: string, exclude: readonly string[]): { email: string | null; phone: string | null; name: string | null } {
  const excluded = new Set(exclude.map((e) => e.toLowerCase()));
  const email = (body.match(/[^\s@<>()",;:]{1,64}@[^\s@<>()",;:]{1,253}\.[a-z]{2,}/gi) ?? []).map((e) => normalizeLeadEmail(e)).find((e): e is string => Boolean(e) && !excluded.has(e!)) ?? null;
  const phone = (body.match(/(?:\+33|0033|0)\s*[1-9](?:[\s.-]*\d{2}){4}/g) ?? []).map(normalizePhone).find((p): p is string => Boolean(p)) ?? null;
  const name = body.match(/^\s*(?:nom|name)\s*:\s*(.{2,80})$/im)?.[1]?.trim() ?? null;
  return { email, phone, name: name && !/[<>@]/.test(name) ? name : null };
}

// --- Réglages -------------------------------------------------------------------------------------------------------

const optionalEmail = z.string().transform((value, ctx) => {
  if (!value.trim()) return null;
  const email = normalizeLeadEmail(value);
  if (!email) { ctx.addIssue({ code: "custom", message: "Adresse e-mail invalide." }); return z.NEVER; }
  return email;
});
export const settingsSchema = z.object({
  enabled: z.boolean(),
  auto_reply: z.boolean(),
  followups: z.number().int().min(0).max(MAX_FOLLOWUPS),
  notify_email: optionalEmail,
  reply_to: optionalEmail,
  callback_promise: z.string().trim().max(120).transform((v) => v || null).refine((v) => v === null || (v.length >= 2 && !/[<>\r\n]/.test(v)), "Formule de rappel invalide."),
  phone: z.string().transform((value, ctx) => { if (!value.trim()) return null; const phone = normalizePhone(value); if (!phone) { ctx.addIssue({ code: "custom", message: "Téléphone invalide." }); return z.NEVER; } return phone; }),
  signature: z.string().trim().max(300).transform((v) => v || null).refine((v) => v === null || !/[<>]/.test(v), "Signature invalide."),
  allowed_origins: z.string().max(2000).transform((value, ctx) => {
    const items = value.split(/[\s,]+/).map((v) => v.trim()).filter(Boolean);
    const origins = items.map(normalizeOrigin);
    if (origins.some((o) => !o)) { ctx.addIssue({ code: "custom", message: "Origine invalide : https://www.exemple.fr (une par ligne, sans chemin)." }); return z.NEVER; }
    if (origins.length > 10) { ctx.addIssue({ code: "custom", message: "10 origines au plus." }); return z.NEVER; }
    return [...new Set(origins as string[])];
  }),
});
export type LeadSettingsInput = z.infer<typeof settingsSchema>;

export type LeadSettings = {
  client_id: string; enabled: boolean; form_key: string; allowed_origins: string[]; auto_reply: boolean; followups: number;
  notify_email: string | null; reply_to: string | null; callback_promise: string | null; phone: string | null; signature: string | null;
};
export function settingsFromRow(row: Record<string, unknown> | null): LeadSettings | null {
  if (!row || typeof row.client_id !== "string" || typeof row.form_key !== "string") return null;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  return {
    client_id: row.client_id, enabled: row.enabled === true, form_key: row.form_key,
    allowed_origins: Array.isArray(row.allowed_origins) ? row.allowed_origins.filter((o): o is string => typeof o === "string") : [],
    auto_reply: row.auto_reply === true, followups: typeof row.followups === "number" ? Math.max(0, Math.min(MAX_FOLLOWUPS, row.followups)) : 2,
    notify_email: str(row.notify_email), reply_to: str(row.reply_to), callback_promise: str(row.callback_promise), phone: str(row.phone), signature: str(row.signature),
  };
}

/** Extrait HTML à coller dans le site du client (formulaire minimal, champ piège, envoi en JavaScript sans dépendance). */
export function formSnippet(endpoint: string): string {
  return [
    `<form id="codev-devis" action="${endpoint}" method="post">`,
    `  <input name="name" placeholder="Nom" autocomplete="name">`,
    `  <input name="email" type="email" placeholder="E-mail" autocomplete="email">`,
    `  <input name="phone" type="tel" placeholder="Téléphone" autocomplete="tel">`,
    `  <input name="postcode" placeholder="Code postal" inputmode="numeric" maxlength="5">`,
    `  <textarea name="message" placeholder="Votre projet" required></textarea>`,
    `  <input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">`,
    `  <button type="submit">Demander un devis</button>`,
    `</form>`,
    `<script>`,
    `document.getElementById("codev-devis").addEventListener("submit", async (e) => {`,
    `  e.preventDefault(); const f = e.currentTarget;`,
    `  const r = await fetch(f.action, { method: "POST", body: new URLSearchParams(new FormData(f)) });`,
    `  f.replaceWith(Object.assign(document.createElement("p"), { textContent: r.ok ? "Merci, votre demande est bien reçue." : "Envoi impossible, merci de nous appeler." }));`,
    `});`,
    `</script>`,
  ].join("\n");
}
