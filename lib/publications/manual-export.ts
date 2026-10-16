import type { PublicationPlatform } from "./types";

// Only public fields from the saved current revision cross this boundary.
// Editorial source, prompts, asset URLs and the workspace never belong here.
export type ManualExportVariant = {
  platform: PublicationPlatform;
  text: string;
  title?: string | null;
  cta?: string | null;
};
export type ManualExportInput = {
  clientName: string;
  subject: string;
  revisionNumber: number | null;
  approved: boolean;
  variants: readonly ManualExportVariant[];
};

const labels: Record<PublicationPlatform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  google_business_profile: "Google Business Profile",
};
const slug = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48).replace(/-$/, "");
const oneLine = (value: string) => value.replace(/[\r\n\t]+/g, " ").trim();

export function prepareManualExport(input: ManualExportInput) {
  if (!input.variants.length) throw new Error("Aucun texte enregistré à récupérer.");
  if (input.variants.length > 3 || input.clientName.length > 300 || input.subject.length > 500
    || (input.revisionNumber !== null && (!Number.isSafeInteger(input.revisionNumber) || input.revisionNumber < 1))) {
    throw new Error("Les textes enregistrés ne peuvent pas être récupérés dans ce format.");
  }
  const platforms = new Set<string>();
  const variants = input.variants.map(variant => {
    if (!Object.hasOwn(labels, variant.platform) || platforms.has(variant.platform)
      || !variant.text.trim() || variant.text.length > 10000
      || (variant.title?.length ?? 0) > 500 || (variant.cta?.length ?? 0) > 500) {
      throw new Error("Les textes enregistrés ne peuvent pas être récupérés dans ce format.");
    }
    platforms.add(variant.platform);
    // A title or CTA is included only when it is a public variant field. The
    // publication's internal subject is never inserted into a platform's text.
    const text = [variant.title, variant.text, variant.cta]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0).join("\n\n");
    return { platform: variant.platform, label: labels[variant.platform], text };
  });
  const version = input.revisionNumber === null ? "Version enregistrée" : `Version ${input.revisionNumber}`;
  const state = input.approved ? "Version approuvée" : "NON APPROUVÉ — validation requise avant publication";
  const content = [
    "Textes préparés",
    `Client : ${oneLine(input.clientName)}`,
    `Sujet : ${oneLine(input.subject)}`,
    version,
    state,
    "La récupération des textes ne publie rien.",
    ...variants.map(variant => `\n=== ${variant.label} ===\n\n${variant.text}`),
  ].join("\n") + "\n";
  const filename = ["publication", slug(input.clientName) || "client", slug(input.subject) || "textes",
    input.revisionNumber === null ? null : `v${input.revisionNumber}`].filter(Boolean).join("-") + ".txt";
  return { variants, content, filename, version };
}

export async function tryCopyPublicationText(text: string, clipboard?: Pick<Clipboard, "writeText">): Promise<boolean> {
  if (!clipboard || typeof clipboard.writeText !== "function") return false;
  try { await clipboard.writeText(text); return true; } catch { return false; }
}
