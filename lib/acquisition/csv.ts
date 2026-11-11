import type { AcquisitionProspect } from "./model";
import { PRESCRIBER_SEGMENTS, type PrescriberSegmentId } from "./prescribers";

/** Neutralise l'injection de formules (Excel/Sheets) et échappe le séparateur. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const HEADERS = ["Entreprise", "Segment", "Score", "Distance (km)", "Adresse", "Code postal", "Commune", "SIREN", "Code NAF", "Site web", "Téléphone", "E-mail générique", "Création (BODACC)", "Pourquoi cette cible", "Source", "Sources des données"];

/** Mention des sources, dont l'attribution OpenStreetMap exigée par la licence ODbL. */
export function dataSources(p: AcquisitionProspect): string {
  return [
    p.siren ? "Sirene (INSEE)" : null,
    p.osm_website || p.osm_phone ? "© contributeurs OpenStreetMap (ODbL)" : null,
    p.places_website || p.places_phone ? "Google Places" : null,
    p.bodacc_created_on ? "BODACC" : null,
    p.contact_email ? "site de l'entreprise" : null,
  ].filter(Boolean).join(", ");
}

/** Export CSV (séparateur « ; », BOM UTF-8) lisible directement dans Excel en français. */
export function prospectsToCsv(prospects: AcquisitionProspect[]): string {
  const rows = prospects.map((p) => [
    p.company_name, p.segment ? PRESCRIBER_SEGMENTS[p.segment as PrescriberSegmentId]?.label ?? p.segment : "",
    p.score ?? "", p.distance_km ?? "", p.address ?? "", p.postal_code ?? "", p.city ?? "",
    p.siren ?? "", p.naf_code ?? "", p.places_website ?? p.osm_website ?? p.website ?? "", p.places_phone ?? p.osm_phone ?? "",
    p.contact_email ?? "", p.bodacc_created_on ?? "",
    p.explanation ?? "", p.source_url ?? "", dataSources(p),
  ].map(csvCell).join(";"));
  return "﻿" + [HEADERS.join(";"), ...rows].join("\r\n") + "\r\n";
}

export function csvFilename(label: string, date: Date = new Date()): string {
  const slug = label.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "client";
  return `prescripteurs-${slug}-${date.toISOString().slice(0, 10)}.csv`;
}
