// Modification SEO préparée pour le dépôt GitHub du site (pur, testable).
// Le contenu exact (fichier, version lue, remplacements) est figé dans l'action à l'approbation (empreinte en base) :
// l'exécution n'applique que ce qui a été approuvé, sur une branche dédiée, via une PR — jamais en production directe.
import { z } from "zod";

export const SEO_BRANCH_PREFIX = "codev-seo/";
const repository = z.string().regex(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/).refine((value) => !value.includes(".."));
const gitRef = z.string().min(1).max(200).regex(/^[A-Za-z0-9._/-]+$/).refine((value) => !value.includes("..") && !value.startsWith("/") && !value.endsWith("/") && !value.endsWith(".lock"));
const sourcePath = z.string().min(1).max(300).regex(/^[A-Za-z0-9._/@()[\]-]+$/).refine((value) => !value.split("/").some((part) => part === ".." || part === "." || part === "") && !value.startsWith(".github/") && !/(^|\/)\.env/.test(value));
const edit = z.object({ find: z.string().min(3).max(2000), replace: z.string().max(2000) }).strict().refine((value) => value.find !== value.replace && !value.find.includes("\0") && !value.replace.includes("\0"));

export const githubChangeSchema = z.object({
  opportunity_id: z.uuid(),
  repository,
  base_branch: gitRef,
  branch: gitRef.refine((value) => value.startsWith(SEO_BRANCH_PREFIX)),
  path: sourcePath,
  base_sha: z.string().regex(/^[0-9a-f]{40}$/),
  edits: z.array(edit).min(1).max(5),
  pr_title: z.string().trim().min(5).max(200),
  pr_body: z.string().trim().min(10).max(6000),
}).strict();
export type GithubChange = z.infer<typeof githubChangeSchema>;

/** Branche dédiée, lisible et unique par opportunité. */
export function seoBranchName(keyword: string, opportunityId: string) {
  const slug = keyword.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "page";
  return `${SEO_BRANCH_PREFIX}${slug}-${opportunityId.slice(0, 8)}`;
}

/** Nombre d'occurrences exactes (sans chevauchement). */
export function occurrences(source: string, find: string) {
  if (!find) return 0;
  let count = 0, index = source.indexOf(find);
  while (index !== -1) { count++; index = source.indexOf(find, index + find.length); }
  return count;
}

/**
 * Applique les remplacements approuvés : chaque texte recherché doit apparaître EXACTEMENT une fois,
 * sinon rien n'est modifié (le fichier a changé ou le remplacement serait ambigu).
 */
export function applyEdits(source: string, edits: GithubChange["edits"]): { ok: true; content: string } | { ok: false; reason: string } {
  let content = source;
  for (const [index, item] of edits.entries()) {
    const count = occurrences(content, item.find);
    if (count !== 1) return { ok: false, reason: count === 0 ? `Remplacement ${index + 1} : texte d’origine introuvable dans le fichier.` : `Remplacement ${index + 1} : texte d’origine présent ${count} fois (ambigu).` };
    content = content.replace(item.find, () => item.replace);
  }
  if (content === source) return { ok: false, reason: "Aucune modification effective." };
  return { ok: true, content };
}

/** Texte à remplacer dans le code : la valeur actuelle entre guillemets (title, description) telle que lue dans le fichier. */
export function quotedValueEdit(source: string, current: string, next: string): { find: string; replace: string } | null {
  if (!current || !next || current === next) return null;
  for (const quote of ['"', "'", "`"]) {
    const find = `${quote}${current}${quote}`;
    if (occurrences(source, find) === 1) {
      if (next.includes(quote) || next.includes("\n")) return null;
      return { find, replace: `${quote}${next}${quote}` };
    }
  }
  if (occurrences(source, `>${current}<`) === 1 && !/[<>]/.test(next)) return { find: `>${current}<`, replace: `>${next}<` };
  return null;
}

export function describeGithubChange(change: Pick<GithubChange, "repository" | "path" | "branch" | "base_branch" | "edits">) {
  return `PR sur ${change.repository} (${change.base_branch} ← ${change.branch}) : ${change.edits.length} remplacement(s) dans ${change.path}`;
}
