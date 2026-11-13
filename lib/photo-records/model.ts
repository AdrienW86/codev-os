// Fiches photo (socle éditorial, lot 2) : règles pures. Aucune lecture, aucun appel.
// Trois niveaux, jamais mélangés : ce que la photo montre (analyse automatique, simple indice), ce que le client a
// écrit en l'envoyant (légende, à vérifier), et ce qu'un administrateur a confirmé (seul niveau citable).

export type PhotoRecord = {
  assetId: string; status: "validated" | "excluded"; intervention: string | null; commune: string | null;
  workMonth: string | null; doneByClient: boolean | null; publicationAllowed: boolean; note: string | null;
};
export type PhotoState = "to_analyze" | "analyzed" | "to_verify" | "validated" | "excluded";

export const photoStateLabels: Readonly<Record<PhotoState, string>> = {
  to_analyze: "À analyser", analyzed: "Analysée (indice seulement)", to_verify: "À vérifier", validated: "Chantier confirmé", excluded: "Exclue",
};

/**
 * État d'une photo. « À vérifier » : analysée et pertinente, avec une légende du client à confirmer, ou une analyse
 * incertaine. Une fiche humaine l'emporte toujours sur l'analyse automatique.
 */
export function photoState(input: { assessment: { verdict: string; manual_verdict: string | null } | null; caption: string | null; record: PhotoRecord | null }): PhotoState {
  if (input.record) return input.record.status;
  if (!input.assessment) return "to_analyze";
  const verdict = input.assessment.manual_verdict ?? input.assessment.verdict;
  if (verdict === "off_topic") return "excluded";
  if (verdict === "to_review" || (input.caption ?? "").trim().length > 0) return "to_verify";
  return "analyzed";
}

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const clean = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");

/**
 * Phrase citable d'un chantier confirmé. Rien si la fiche n'est pas validée, si le chantier n'est pas celui de
 * l'entreprise ou si la publication n'est pas autorisée : l'agent reste alors sur un conseil général.
 */
export function confirmedJobText(record: PhotoRecord | null): string | null {
  if (!record || record.status !== "validated" || record.doneByClient !== true || !record.publicationAllowed || !record.intervention) return null;
  const month = record.workMonth && /^\d{4}-\d{2}-01$/.test(record.workMonth) ? `${MONTHS[Number(record.workMonth.slice(5, 7)) - 1]} ${record.workMonth.slice(0, 4)}` : null;
  return [`Chantier réalisé par l’entreprise : ${record.intervention}`, record.commune ? `à ${record.commune}` : null, month ? `(${month})` : null].filter(Boolean).join(" ") + ".";
}

export type PhotoRecordInput = { decision: "validate" | "exclude"; intervention: string | null; commune: string | null; workMonth: string | null; doneByClient: boolean | null; publicationAllowed: boolean; note: string | null };

/** Saisie de la fiche par l'administrateur. Valider exige l'intervention et la réponse « réalisé par l'entreprise ». */
export function parsePhotoRecordInput(form: { decision: unknown; intervention?: unknown; commune?: unknown; month?: unknown; doneByClient?: unknown; publicationAllowed?: unknown; note?: unknown }, today: string):
  { ok: true; value: PhotoRecordInput } | { ok: false; message: string } {
  const decision = form.decision === "validate" ? "validate" : form.decision === "exclude" ? "exclude" : null;
  if (!decision) return { ok: false, message: "Décision inconnue." };
  const note = clean(form.note).slice(0, 300) || null;
  if (decision === "exclude") return { ok: true, value: { decision, intervention: null, commune: null, workMonth: null, doneByClient: null, publicationAllowed: false, note } };
  const intervention = clean(form.intervention), commune = clean(form.commune), month = clean(form.month);
  if (intervention.length < 2 || intervention.length > 200) return { ok: false, message: "Indiquez l’intervention réalisée (2 à 200 caractères)." };
  if (commune && (commune.length < 2 || commune.length > 100)) return { ok: false, message: "Commune invalide." };
  if (month && (!/^\d{4}-\d{2}$/.test(month) || `${month}-01` > today)) return { ok: false, message: "Mois du chantier invalide ou futur." };
  const done = form.doneByClient === "yes" ? true : form.doneByClient === "no" ? false : null;
  if (done === null) return { ok: false, message: "Précisez si le chantier a été réalisé par l’entreprise." };
  return { ok: true, value: { decision, intervention, commune: commune || null, workMonth: month ? `${month}-01` : null, doneByClient: done, publicationAllowed: form.publicationAllowed === "on" || form.publicationAllowed === "yes", note } };
}
