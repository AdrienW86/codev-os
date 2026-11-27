// Contrôle anti-invention des textes rédigés par l'IA à partir de chiffres déjà calculés. Module pur.
// Règle : tout nombre écrit par le modèle doit figurer, à l'identique, dans les données qu'on lui a fournies. Un calcul
// nouveau (pourcentage, total, moyenne) ou un chiffre inventé fait refuser le texte : le rendu sans IA reste en place.

const NUMBER = /\d+(?:[   .]\d{3})*(?:,\d+|\.\d+)?/g;

/** Nombres d'un texte, normalisés (séparateurs de milliers retirés, virgule décimale → point, zéros finaux retirés). */
export function numbersOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.match(NUMBER) ?? []) {
    const grouped = /^\d{1,3}(?:[   .]\d{3})+(?:,\d+)?$/.test(raw);
    let value = grouped ? raw.replace(/[   .]/g, "") : raw;
    value = value.replace(",", ".");
    if (value.includes(".")) value = value.replace(/0+$/, "").replace(/\.$/, "");
    out.add(value.replace(/^0+(?=\d)/, ""));
  }
  return out;
}

/** Nombres du texte absents de la source (vide = texte fondé sur les données). */
export function ungroundedNumbers(text: string, source: string | Set<string>): string[] {
  const known = typeof source === "string" ? numbersOf(source) : source;
  return [...numbersOf(text)].filter((value) => !known.has(value));
}

/** Texte libre propre : sans balise, sans caractère de contrôle, espaces compactés, longueur bornée. */
export function cleanAiText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!text || text.length > max || /<\/?[a-z][^>]*>|```/i.test(text)) return null;
  return text;
}
