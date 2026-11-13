// Agent Copywriter — relecture de style (pur, testable, sans IA). Repère ce qui rend un texte creux, mécanique ou
// « généré » : formules toutes faites, superlatifs vides, connecteurs en cascade, phrases de longueur uniforme, mêmes
// débuts de phrase, tirets longs, mélange du tutoiement et du vouvoiement. La note guide un nouvel essai de rédaction
// et la relecture humaine ; elle ne prétend pas dire si un détecteur d'IA reconnaîtra le texte (aucun outil ne le peut).

export type StyleIssue = { code: string; level: "warning" | "info"; message: string };
export type StyleAudit = { score: number; words: number; sentences: number; issues: StyleIssue[] };
export type Address = "vous" | "tu";

/** Note à partir de laquelle un texte est jugé naturel ; en dessous, l'agent rédacteur fait un nouvel essai. */
export const STYLE_GOOD_SCORE = 75;

/**
 * Formules toutes faites, typiques des textes génériques (formes sans accents, comparées au texte replié).
 * Le libellé affiché est la forme usuelle.
 */
export const STOCK_PHRASES: readonly { fold: string; label: string }[] = [
  "dans un monde ou", "a l ere du", "a l heure ou", "dans le paysage", "que vous soyez", "que ce soit pour", "n hesitez pas", "n attendez plus",
  "il est essentiel de", "il est important de", "il est crucial de", "il convient de", "il est primordial de", "force est de constater",
  "en conclusion", "pour conclure", "en definitive", "en somme", "vous l aurez compris", "sans plus attendre", "plongeons", "decouvrons ensemble",
  "dans cet article", "nous allons voir", "un veritable", "une veritable", "incontournable", "au coeur de", "tirer le meilleur parti",
  "faire toute la difference", "fait toute la difference", "gage de qualite", "solutions sur mesure", "solution sur mesure", "notre priorite",
  "votre satisfaction", "pas de panique", "bonne nouvelle", "offrez vous", "laissez vous", "booster", "sublimer", "revolutionner",
  "en un clin d oeil", "un jeu d enfant", "la cle du succes", "l alliance parfaite", "alliant", "en toute serenite",
].map((label) => ({ fold: label, label: label.replace(/\bl /g, "l’").replace(/\bn /g, "n’").replace(/\bd /g, "d’") }));

const HYPE = ["exceptionnel", "exceptionnelle", "parfait", "parfaite", "ideal", "ideale", "optimal", "optimale", "ultime", "inegale", "inegalee",
  "incomparable", "remarquable", "sublime", "magnifique", "epoustouflant", "epoustouflante", "revolutionnaire", "unique", "extraordinaire", "irreprochable"];
const CONNECTORS = ["de plus", "par ailleurs", "en outre", "ainsi", "en effet", "cependant", "neanmoins", "toutefois", "en revanche", "d ailleurs", "egalement", "enfin", "finalement"];
const AI_SELF = /\b(en tant qu.?(ia|intelligence artificielle|assistant)|mod[eè]le de langage|je suis une? (ia|intelligence artificielle))\b/i;

/** Texte replié : minuscules, sans accents, ponctuation en espaces (apostrophes comprises). */
export const fold = (text: string) => ` ${text.toLocaleLowerCase("fr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;

/** Texte de lecture : sans intertitres Markdown ni marques de liste (ils suivent leurs propres règles). */
export function readableText(text: string): string {
  return text.replace(/\r\n?/g, "\n").split("\n").filter((line) => !/^\s*#{1,6}\s/.test(line))
    .map((line) => line.replace(/^\s*([-*•]|\d+[.)])\s+/, "").replace(/[*_]{1,2}/g, "")).join("\n");
}

/** Phrases d'un texte (les lignes de liste comptent comme des phrases). */
export function sentencesOf(text: string): string[] {
  return readableText(text).split(/(?<=[.!?…])\s+|\n+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length >= 3);
}
const wordsOf = (text: string) => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));

/** Adresse au lecteur demandée par les consignes de communication du client (« tutoiement », « on vouvoie »…), sinon null. */
export function addressFromGuidelines(guidelines: string | null | undefined): Address | null {
  const text = fold(guidelines ?? "");
  const tu = /\b(tutoi\w*|tutoyer)\b/.test(text), vous = /\b(vouvoi\w*|vouvoyer)\b/.test(text);
  if (tu && !vous) return "tu";
  if (vous && !tu) return "vous";
  return null;
}

/** Le texte tutoie-t-il ou vouvoie-t-il son lecteur ? Les deux peuvent être vrais (mélange). */
export function addressUsed(text: string): { vous: boolean; tu: boolean } {
  const t = fold(readableText(text));
  return {
    vous: /\b(vous|votre|vos)\b/.test(t),
    // « te », « t’ » et « ta » sont ambigus (« peut-il », « ta » rare) : seules les formes nettes comptent.
    tu: /\s(tu|toi|ton|tes)\s/.test(t),
  };
}

const PENALTY: Record<string, number> = {
  ai_self: 40, address_mix: 12, address_wrong: 12, stock_phrases: 0, hype: 8, connectors: 8, uniform_sentences: 8, repeated_openers: 6,
  em_dash: 5, exclamation: 4, long_sentences: 4, triads: 4,
};

/**
 * Note de naturel sur 100 et remarques actionnables (pénalités fixes, déterministes). Les formules toutes faites
 * coûtent 5 points chacune (30 au plus).
 */
export function auditStyle(text: string, options: { address?: Address | null } = {}): StyleAudit {
  const issues: StyleIssue[] = [];
  let stockCost = 0;
  const add = (code: string, message: string, level: StyleIssue["level"] = "warning") => issues.push({ code, level, message });
  const body = readableText(text), folded = fold(body), words = wordsOf(body), sentences = sentencesOf(text);
  const n = words.length || 1;

  if (AI_SELF.test(body)) add("ai_self", "Le texte parle de lui-même comme d’une IA : à retirer.");

  const stock = STOCK_PHRASES.filter((p) => folded.includes(` ${p.fold} `) || (p.fold.split(" ").length === 1 && new RegExp(`\\s${p.fold}\\w*\\s`).test(folded)));
  if (stock.length) {
    stockCost = Math.min(30, stock.length * 5);
    add("stock_phrases", `Formules toutes faites à remplacer par du concret : ${stock.slice(0, 8).map((p) => `« ${p.label} »`).join(", ")}.`);
  }

  const hype = folded.split(" ").filter((w) => HYPE.includes(w)).length;
  if (hype >= 2 && hype / n * 150 > 1) add("hype", `${hype} superlatifs (« exceptionnel », « parfait », « idéal »…) : un fait précis convainc mieux qu’un adjectif.`);

  const openers = sentences.map((s) => fold(s).trim());
  const linked = openers.filter((s) => CONNECTORS.some((c) => s === c || s.startsWith(`${c} `))).length;
  if (sentences.length >= 5 && linked / sentences.length > 0.3) add("connectors", "Trop de phrases commencent par un connecteur (« De plus », « Ainsi », « En effet »…) : le texte paraît mécanique.");

  const lengths = sentences.map((s) => wordsOf(s).length);
  if (lengths.length >= 8) {
    const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const sd = Math.sqrt(lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / lengths.length);
    if (mean > 0 && sd / mean < 0.3) add("uniform_sentences", "Phrases presque toutes de la même longueur : alterner phrases courtes et plus longues donne du rythme.");
  }

  const firsts = new Map<string, number>();
  for (const s of openers) { const w = s.split(" ")[0]; if (w && !["le", "la", "les", "l", "un", "une", "des", "de", "d"].includes(w)) firsts.set(w, (firsts.get(w) ?? 0) + 1); }
  const [topWord, topCount] = [...firsts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  if (sentences.length >= 5 && topCount >= 3 && topCount / sentences.length > 0.35) add("repeated_openers", `${topCount} phrases commencent par « ${topWord} » : varier les débuts de phrase.`);

  const dashes = (body.match(/—/g) ?? []).length;
  if (dashes >= 2 && dashes / n * 150 > 1) add("em_dash", "Tirets longs « — » en série : en français, préférer la virgule, les deux-points ou une nouvelle phrase.", "info");

  const bangs = (body.match(/!/g) ?? []).length;
  if (bangs >= 2 && bangs / n * 100 > 1) add("exclamation", "Points d’exclamation trop nombreux : ton trop commercial.", "info");

  const long = lengths.filter((l) => l > 35).length;
  if (long) add("long_sentences", `${long} phrase${long > 1 ? "s" : ""} de plus de 35 mots : couper en deux.`, "info");

  const triads = (body.match(/\b[\p{L}’'-]{3,},\s[\p{L}’'-]{3,}\set\s[\p{L}’'-]{3,}\b/gu) ?? []).length;
  if (triads >= 3 && triads / n * 200 >= 2) add("triads", "Énumérations par trois en série (« simple, rapide et efficace ») : un tic de texte générique.", "info");

  const used = addressUsed(body);
  if (used.vous && used.tu) add("address_mix", "Le texte mélange tutoiement et vouvoiement.");
  else if (options.address === "vous" && used.tu) add("address_wrong", "Le client vouvoie ses lecteurs : le texte les tutoie.");
  else if (options.address === "tu" && used.vous && !used.tu) add("address_wrong", "Le client tutoie ses lecteurs : le texte les vouvoie.");

  const cost = issues.reduce((sum, i) => sum + (i.code === "stock_phrases" ? stockCost : PENALTY[i.code] ?? 0), 0);
  return { score: Math.max(0, 100 - cost), words: words.length, sentences: sentences.length, issues };
}

/** Retour donné au rédacteur IA pour un nouvel essai : les remarques de style, sans jugement sur la détection d'IA. */
export const styleFeedback = (audit: StyleAudit) => `note de naturel ${audit.score}/100 ; à corriger : ${audit.issues.map((i) => i.message).join(" ")}`;

/**
 * Consignes d'écriture du Copywriter, ajoutées aux consignes des agents rédacteurs (Blog, Newsletter, Publications) :
 * la même exigence de style partout, sans rien changer à leurs règles anti-invention.
 */
export const COPY_STYLE_RULES = [
  "Style d’un copywriter senior : écris comme un professionnel du métier qui parle à un client, pas comme une brochure.",
  "Du concret plutôt que des adjectifs : un geste, un signe à surveiller, une étape, une situation que le lecteur reconnaît (sans rien inventer sur l’entreprise).",
  "Rythme : alterne phrases courtes et phrases plus longues ; varie les débuts de phrase ; une idée par phrase.",
  "Proscrits : « Dans un monde où », « Que vous soyez », « N’hésitez pas », « Il est essentiel de », « En conclusion », « Un véritable », « incontournable », « au cœur de », « faire toute la différence », « sur mesure », « booster », les superlatifs vides (« exceptionnel », « parfait », « idéal »), les énumérations par trois en série et les tirets longs « — ».",
  "Voix active, verbes précis, vocabulaire du client final ; suis les consignes de communication du client quand elles sont fournies (ton, tutoiement ou vouvoiement, mots à éviter), sans jamais mélanger tutoiement et vouvoiement.",
].join("\n");
