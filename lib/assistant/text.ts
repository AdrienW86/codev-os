// Normalisation du texte libre (pur) : minuscules, sans accents ni apostrophes typographiques.
export const normalize = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’']/g, " ").replace(/\s+/g, " ").trim();
