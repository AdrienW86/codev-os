// Registre éditorial permanent (socle éditorial, lot 3) : règles pures. Aucune lecture, aucun appel.
// Le registre réunit, par client, tout ce qui a été publié ou proposé sur chaque canal (réseaux sociaux, blog,
// newsletter) et les sujets réservés au moment de la planification. Un agent consulte le registre avant d'écrire :
// un sujet déjà traité (même formulé autrement) ou déjà réservé par un autre agent est refusé.
// Détection des doublons : déterministe (mots significatifs, paires de mots, prestation et angle). Le contrôle
// anti-doublon par un modèle IA indépendant viendra s'y ajouter (lot 4), jamais le remplacer.
import { normalizeText, textSimilarity } from "@/lib/publications/editorial-text";

export const REGISTER_CHANNELS = ["social", "blog", "newsletter"] as const;
export type RegisterChannel = typeof REGISTER_CHANNELS[number];
export const registerChannelLabels: Readonly<Record<RegisterChannel, string>> = { social: "Réseaux sociaux", blog: "Blog", newsletter: "Newsletter" };

export type RegisterEntry = {
  channel: RegisterChannel; topic: string; service: string | null; angle: string | null;
  /** used : publié ou proposé ; reserved : sujet retenu par un agent, en cours d'écriture. */
  status: "used" | "reserved"; date: string; ref: string;
};
export type RegisterCandidate = { channel: RegisterChannel; topic: string; service?: string | null; angle?: string | null };
export type DuplicateMatch = { entry: RegisterEntry; reason: "same_topic" | "same_service_angle" | "reserved_elsewhere"; similarity: number };

/** Fenêtres : un sujet ne revient pas sur le même canal avant 6 mois ; prestation + angle identiques, pas avant 3 mois. */
export const SAME_CHANNEL_DAYS = 180, SAME_ANGLE_DAYS = 90, RESERVATION_DAYS = 14;
/** Seuils de ressemblance (0 à 1) : au-delà, deux sujets sont considérés comme le même sujet. */
export const SAME_TOPIC = 0.6, CROSS_CHANNEL_RESERVED = 0.75;

const STOPWORDS = new Set(("a au aux avec ce ces cet cette comme comment dans de des du elle en est et etre il ils la le les leur leurs mais ne nos notre nous on ou par pas " +
  "plus pour pourquoi qu quand que quel quelle quelles quels qui sa sans se ses si son sont sur ta te tes ton tous tout toute toutes un une vos votre vous y " +
  "faut faire bien bon bonne bons bonnes votre vos chez tout guide conseils conseil astuces").split(" "));
const stem = (word: string) => word.length > 3 ? word.replace(/(s|x)$/, "").replace(/e$/, "") : word;

/** Mots significatifs d'un sujet (sans accents, sans mots vides, au singulier approximatif), triés et uniques. */
export function topicWords(text: string): string[] {
  return [...new Set(normalizeText(text).split(" ").filter((w) => w.length > 1 && !STOPWORDS.has(w) && !/^\d+$/.test(w)).map(stem))].sort();
}
/** Empreinte d'un sujet : deux formulations aux mêmes mots significatifs ont la même empreinte. */
export const topicFingerprint = (text: string) => topicWords(text).join(" ").slice(0, 300);

/** Ressemblance de deux sujets : la plus forte entre les mots significatifs (Jaccard) et les paires de mots. */
export function topicSimilarity(a: string, b: string): number {
  const x = new Set(topicWords(a)), y = new Set(topicWords(b));
  let common = 0; for (const w of x) if (y.has(w)) common++;
  const words = x.size && y.size ? common / (x.size + y.size - common) : 0;
  return Math.max(words, textSimilarity(a, b));
}

const sameText = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && normalizeText(a) === normalizeText(b));
const daysBetween = (date: string, now: Date) => (now.getTime() - new Date(date).getTime()) / 86_400_000;

/**
 * Doublon d'un sujet candidat dans le registre, ou null. Même canal : sujet ressemblant sur 6 mois, ou même prestation
 * avec le même angle sur 3 mois. Autre canal : seul un sujet réservé et quasi identique bloque (un autre agent est en
 * train de l'écrire) ; un sujet publié ailleurs reste permis (un article de blog peut nourrir une publication).
 */
export function findDuplicate(candidate: RegisterCandidate, entries: readonly RegisterEntry[], now: Date): DuplicateMatch | null {
  let best: DuplicateMatch | null = null;
  for (const entry of entries) {
    const age = daysBetween(entry.date, now);
    const similarity = topicSimilarity(candidate.topic, entry.topic);
    let reason: DuplicateMatch["reason"] | null = null;
    if (entry.channel === candidate.channel) {
      if (age <= SAME_CHANNEL_DAYS && similarity >= SAME_TOPIC) reason = "same_topic";
      else if (age <= SAME_ANGLE_DAYS && sameText(candidate.service, entry.service) && sameText(candidate.angle, entry.angle)) reason = "same_service_angle";
    } else if (entry.status === "reserved" && similarity >= CROSS_CHANNEL_RESERVED) reason = "reserved_elsewhere";
    if (reason && (!best || similarity > best.similarity)) best = { entry, reason, similarity };
  }
  return best;
}

export const duplicateMessage = (match: DuplicateMatch) => match.reason === "reserved_elsewhere"
  ? `Sujet déjà réservé (${registerChannelLabels[match.entry.channel]}) : « ${match.entry.topic} ».`
  : `Sujet déjà traité (${registerChannelLabels[match.entry.channel]}, ${match.entry.date.slice(0, 10)}) : « ${match.entry.topic} ».`;

/** Premier sujet libre parmi des candidats (ordre de préférence de l'agent), avec le doublon de chaque sujet écarté. */
export function firstFreeTopic<T extends RegisterCandidate>(candidates: readonly T[], entries: readonly RegisterEntry[], now: Date): { choice: T | null; skipped: { candidate: T; match: DuplicateMatch }[] } {
  const skipped: { candidate: T; match: DuplicateMatch }[] = [];
  for (const candidate of candidates) {
    const match = findDuplicate(candidate, entries, now);
    if (!match) return { choice: candidate, skipped };
    skipped.push({ candidate, match });
  }
  return { choice: null, skipped };
}

/**
 * Registre compact transmis à un agent : les sujets récents de TOUS les canaux (plus récents d'abord), pour éviter de
 * répéter un sujet et pour rester cohérent d'un canal à l'autre. Donnée, jamais source de faits.
 */
export function registerBrief(entries: readonly RegisterEntry[], now: Date, limit = 40): { date: string; channel: RegisterChannel; topic: string; status: RegisterEntry["status"] }[] {
  return [...entries].filter((e) => daysBetween(e.date, now) <= SAME_CHANNEL_DAYS).sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit)
    .map((e) => ({ date: e.date.slice(0, 10), channel: e.channel, topic: e.topic.replace(/\s+/g, " ").trim().slice(0, 160), status: e.status }));
}
