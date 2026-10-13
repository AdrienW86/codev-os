// Lecture déterministe des demandes Publications (français, pur, testable) : préparation Agent v2, file à valider,
// photo écartée, comptes à reconnecter, clients à court de photos, reprogrammation. Tolère les transcriptions
// vocales (sans ponctuation ni accents). Ne produit que des appels d'outils du registre ou une question de précision ;
// les écritures restent des PROPOSITIONS à confirmer. Aucune lecture ne publie ni n'approuve quoi que ce soit.
import { normalize } from "@/lib/assistant/text";
import type { AssistantContext } from "@/lib/assistant/views";
import { addDaysIso, MAX_ASSISTANT_PREPARATIONS } from "@/lib/assistant/publications-model";

type Intent = { tool: "publications_prepare" | "publications_review_list" | "publications_photo_explain" | "publications_reconnect_list" | "publications_photo_shortage" | "publications_reschedule"; input: Record<string, unknown> } | { clarify: string };

const publicationWord = /\b(publications?|posts?|publi)\b/;
const numberWords: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10 };
const ordinalWords: Record<string, number> = { premier: 1, premiere: 1, deuxieme: 2, second: 2, seconde: 2, troisieme: 3, quatrieme: 4, cinquieme: 5, sixieme: 6, septieme: 7, huitieme: 8, neuvieme: 9, dixieme: 10 };

// --- Nom de client -------------------------------------------------------------------------------
const markers = new Set(["de", "du", "pour", "chez", "d"]);
/** Mots qui terminent un nom de client dans une phrase (forme normalisée). */
const stopWords = new Set(["pour", "la", "le", "les", "a", "est", "sont", "qui", "que", "avec", "sur", "semaine", "cette", "ce", "ces", "demain", "aujourd", "n", "ne", "au", "aux",
  "a", "ete", "doivent", "doit", "manquent", "dans", "en", "vendredi", "lundi", "mardi", "mercredi", "jeudi", "samedi", "dimanche", "projet", "et", "s", "il", "elle", "on"]);
/** Débuts qui ne désignent jamais un client (« de la semaine », « de photos », « pour cette publication »…). */
const notClient = new Set(["la", "le", "les", "l", "des", "ces", "cette", "ce", "mes", "nos", "ma", "mon", "photos", "photo", "publication", "publications", "post", "posts", "semaine", "client", "clients",
  "comptes", "compte", "valider", "validation", "lui", "elle", "eux", "moi", "nous", "tous", "toutes", "tout", "un", "une", "deux", "trois", "quatre", "cinq", "instagram", "facebook", "google", "reconnecter",
  "suite", "plus", "nouvelles", "nouveau", "nouvelle", "manque", "quoi", "rien", "ici", "assez"]);

/** Nom de client après « de / du / pour / chez / d' » (texte d'origine conservé) ; le premier candidat plausible. */
export function publicationClient(original: string): string | null {
  const words = original.replace(/[’']/g, "' ").split(/\s+/).filter(Boolean);
  for (let index = 0; index < words.length - 1; index++) {
    const marker = normalize(words[index]).replace(/[^a-z]/g, "");
    if (!markers.has(marker)) continue;
    const taken: string[] = [];
    for (let next = index + 1; next < words.length; next++) {
      const raw = words[next];
      const cleaned = raw.replace(/^[«"(]+|[»")?!.,;:]+$/g, "");
      const key = normalize(cleaned).replace(/'$/, "");
      if (!cleaned || (taken.length > 0 && stopWords.has(key)) || (taken.length === 0 && (notClient.has(key) || stopWords.has(key) || /^\d/.test(key)))) break;
      taken.push(cleaned.replace(/'$/, ""));
      if (/[?!.,;:»")]$/.test(raw) || taken.length >= 6) break;
    }
    if (taken.length && taken.join(" ").length >= 2) return taken.join(" ").slice(0, 120);
  }
  return null;
}

// --- Date et heure ---------------------------------------------------------------------------------
const weekdays = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const months = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];
const pad = (value: number) => String(value).padStart(2, "0");

/** « vendredi 18 h », « demain 9h30 », « le 16 octobre à 18 heures », « 2026-10-16 18:00 » → date et heure locales, ou ce qui manque. */
export function slotParts(value: string, today: string): { date?: string; time?: string; invalid?: true } {
  const result: { date?: string; time?: string; invalid?: true } = {};
  const time = value.match(/(?<![\d-])(\d{1,2})\s*(?:h|heures?|:)\s*(\d{2})?(?!\d)/);
  if (time) {
    const [hour, minute] = [Number(time[1]), Number(time[2] ?? 0)];
    if (hour > 23 || minute > 59) result.invalid = true; else result.time = `${pad(hour)}:${pad(minute)}`;
  }
  const iso = value.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const named = value.match(new RegExp(`\\b(\\d{1,2})(?:er)? (${months.join("|")})\\b`));
  const numeric = value.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  const year = Number(today.slice(0, 4));
  const dated = (month: number, day: number) => {
    if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
    const candidate = `${year}-${pad(month)}-${pad(day)}`;
    return candidate < today ? `${year + 1}-${pad(month)}-${pad(day)}` : candidate;
  };
  if (iso) result.date = iso[1];
  else if (named) result.date = dated(months.indexOf(named[2]) + 1, Number(named[1]));
  else if (numeric) result.date = dated(Number(numeric[2]), Number(numeric[1]));
  else if (/\bdemain\b/.test(value)) result.date = addDaysIso(today, 1);
  else if (/\baujourd hui\b/.test(value)) result.date = today;
  else {
    const index = weekdays.findIndex((day) => new RegExp(`\\b${day}\\b`).test(value));
    if (index >= 0) {
      const current = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
      result.date = addDaysIso(today, ((index - current + 7) % 7) || 7);
    }
  }
  return result;
}

/** Rang demandé (« la 2 », « la deuxième », « la photo 3 », « numéro 1 ») ; null s'il n'y en a pas. */
export function ordinal(value: string): number | null {
  const word = value.match(new RegExp(`\\b(${Object.keys(ordinalWords).join("|")})\\b`));
  if (word) return ordinalWords[word[1]];
  const digit = value.match(/\b(?:la|le|numero|n|no|photo|publication|post)\s+(\d{1,2})(?:e|eme|er|ere|re)?\b(?!\s*(?:h|heures?|:|\/|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre))/)
    ?? value.match(/\b(\d{1,2})(?:e|eme|er|ere|re)\b(?!\s*(?:janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre))/);
  return digit ? Number(digit[1]) : null;
}

const contextItem = (context: AssistantContext, view: AssistantContext["view"], rank: number | null) =>
  rank && context.view === view && context.items && rank >= 1 && rank <= context.items.length ? context.items[rank - 1] : undefined;

// --- Garde-fou : publier / approuver -----------------------------------------------------------------
/**
 * « Publie… », « approuve… », « valide la publication… », « mets en ligne… » : jamais exécuté par l'assistant.
 * L'approbation reste un geste de l'interface (carte de validation) et la diffusion suit le moteur existant.
 */
export function isPublishRequest(text: string) {
  const value = normalize(text);
  if (/\b(a valider|a approuver|en attente|montre|affiche|liste|quelles?|combien|pourquoi|taches?|rapports?)\b/.test(value)) return false;
  const verb = /\b(publie[rz]?|publies|diffuse[rz]?|approuve[rz]?|valide[rz]?|poste[rz]?|mets? en ligne|mettre en ligne|envoie[rz]? (la|les|cette|ces) publications?)\b/.test(value);
  return verb && (publicationWord.test(value) || /\b(instagram|facebook|google business|fiche google|reseaux sociaux|maintenant|tout de suite)\b/.test(value) || /^(publie|diffuse|approuve)\b/.test(value));
}

export const PUBLISH_REFUSED_REPLY = "Je ne publie ni n’approuve aucune publication : l’approbation se fait sur la carte de validation (Publications › À valider) et la diffusion suit ensuite les règles existantes (interrupteurs, créneau, approbation humaine). Je peux afficher les publications à valider.";

// --- Analyse ---------------------------------------------------------------------------------------
export function parsePublicationsIntent(original: string, value: string, today: string, context: AssistantContext = {}): Intent | null {
  const rank = ordinal(value);

  // Reprogrammation (écriture : proposée, jamais exécutée sans confirmation).
  if (/\b(reprogramme[rz]?|reprogrammes|decale[rz]?|deplace[rz]?|repousse[rz]?)\b/.test(value)
    && (publicationWord.test(value) || (context.publicationId && /\b(la|celle.ci|celle.la)\b/.test(value)) || (context.view === "publications_list" && rank !== null))) {
    const slot = slotParts(value, today);
    if (slot.invalid) return { clarify: "L’heure indiquée n’est pas valide. À quelle heure (HH:MM) ?" };
    if (!slot.date || !slot.time) return { clarify: `À quel ${slot.date ? "horaire" : "jour"} reprogrammer la publication ? Par exemple « vendredi 18 h » (heure de Paris).` };
    const target: Record<string, unknown> = { date: slot.date, time: slot.time };
    const listed = contextItem(context, "publications_list", rank);
    const client = publicationClient(original.replace(/\s+(?:à|a|au)\s+(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|demain).*$/i, ""));
    if (listed) target.publication_id = listed;
    else if (rank && context.view === "publications_list") return { clarify: "Je ne retrouve pas cette publication dans la dernière liste affichée. Demandez « Montre-moi les publications à valider », puis indiquez son numéro." };
    else if (client) target.client = client;
    else if (context.publicationId && /\b(cette|celle.ci|celle.la|la publication|ce post|la|le)\b/.test(value)) target.publication_id = context.publicationId;
    else return { clarify: "Quelle publication reprogrammer ? Ouvrez-la depuis la liste (« Montre-moi les publications à valider ») ou précisez le client." };
    return { tool: "publications_reschedule", input: target };
  }

  // Préparation Agent v2 (écriture : brouillons uniquement, proposée puis confirmée).
  if (/\b(prepare[rz]?|prepares|genere[rz]?|generes|redige[rz]?|rediges|cree[rz]?|crees|ecris|ecrire)\b/.test(value) && publicationWord.test(value) && !/\brapport/.test(value)) {
    const countMatch = value.match(new RegExp(`\\b(\\d{1,2}|${Object.keys(numberWords).join("|")}) (?:nouvelles? |autres? )?(?:publications?|posts?)\\b`));
    const count = countMatch ? (numberWords[countMatch[1]] ?? Number(countMatch[1])) : null;
    const nextWeek = /\bsemaine prochaine\b|\bprochaine semaine\b/.test(value);
    const client = publicationClient(original) ?? (/\b(ce client|ce meme client|pour lui|pour elle)\b/.test(value) ? context.clientName ?? null : null);
    if (!client) return { clarify: "Pour quel client dois-je préparer les publications ?" };
    if (count !== null && (count < 1 || count > MAX_ASSISTANT_PREPARATIONS)) return { clarify: `Je peux préparer de 1 à ${MAX_ASSISTANT_PREPARATIONS} publications par demande. Combien pour ${client} ?` };
    if (!nextWeek && /\b(cette semaine|ce mois|mois prochain|semaines|bientot|prochainement|plus tard)\b/.test(value)) return { clarify: `Pour ${client}, je peux préparer la semaine prochaine ou un nombre de publications (${MAX_ASSISTANT_PREPARATIONS} au plus). Que souhaitez-vous ?` };
    if (count === null && !nextWeek) return { clarify: `Combien de publications préparer pour ${client} (${MAX_ASSISTANT_PREPARATIONS} au plus), ou pour la semaine prochaine ?` };
    const project = original.match(/\bprojet\s+([^,.;:!?]+?)(?:\s+pour\b|[,.;:!?]|$)/i)?.[1]?.trim();
    return { tool: "publications_prepare", input: { client, ...(nextWeek ? { period: "next_week" } : { count }), ...(project ? { project: project.slice(0, 120) } : {}) } };
  }

  // File de validation (lecture seule).
  if (publicationWord.test(value) && /\b(a valider|a approuver|a relire|en attente( de validation)?|a verifier|a controler)\b/.test(value)) {
    const client = publicationClient(original);
    return { tool: "publications_review_list", input: client ? { client } : {} };
  }

  // Photo écartée : pourquoi ? (lecture seule ; on demande laquelle si plusieurs).
  const photoQuestion = /\b(photos?|images?|clich\w*)\b/.test(value) && /\b(pourquoi|raison|explique\w*|motif)\b/.test(value);
  const photoFollowUp = context.view === "publication_photos" && rank !== null && /^(et )?(la |le )?(photo |numero )?\w+( photo)?( alors| stp| s il te plait)?\s*\??$|\bpourquoi\b/.test(value);
  if (photoQuestion || photoFollowUp) {
    const listed = contextItem(context, "publication_photos", rank);
    if (rank && context.view === "publication_photos" && !listed) return { clarify: "Je ne retrouve pas cette photo dans la dernière liste affichée. Indiquez un numéro de la liste." };
    const client = publicationClient(original) ?? context.clientName ?? null;
    if (listed) return { tool: "publications_photo_explain", input: { photo_id: listed, ...(client ? { client } : {}) } };
    if (context.assetId && /\b(cette|celle.ci|cette photo)\b/.test(value) && !publicationClient(original)) return { tool: "publications_photo_explain", input: { photo_id: context.assetId, ...(client ? { client } : {}) } };
    if (!client) return { clarify: "De quel client est cette photo ?" };
    return { tool: "publications_photo_explain", input: { client } };
  }

  // Comptes à reconnecter (lecture seule).
  if (/\b(comptes?|connexions?|acces)\b/.test(value) && /\b(reconnect\w*|deconnect\w*|expire\w*|revoque\w*|a renouveler|plus connect\w*)\b/.test(value)) {
    const platform = /\binstagram\b/.test(value) ? "instagram" : /\bfacebook\b/.test(value) ? "facebook" : /\b(google business|google my business|fiche google|gbp|google)\b/.test(value) ? "google_business_profile" : null;
    const client = publicationClient(original);
    return { tool: "publications_reconnect_list", input: { ...(platform ? { platform } : {}), ...(client ? { client } : {}) } };
  }

  // Clients à court de photos (lecture seule).
  if (/\bphotos?\b/.test(value) && (/\bclients?\b/.test(value) || /\bqui\b/.test(value)) && /\b(manque\w*|pas assez|trop peu|peu de|sans|besoin|a court|insuffisant\w*|plus de)\b/.test(value))
    return { tool: "publications_photo_shortage", input: {} };

  return null;
}
