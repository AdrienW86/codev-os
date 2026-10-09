import type { ClientField, ClientInput } from "./types";

export const clientFieldLimits = {
  name: 200, company_name: 200, activity: 300, email: 254,
  phone: 50, website: 2048, geographic_area: 300, notes: 5000,
} satisfies Record<ClientField, number>;

export function validateClientForm(formData: FormData):
  | { ok: true; data: ClientInput }
  | { ok: false; errors: Partial<Record<ClientField, string>> } {
  const values: Record<string, string | null> = {};
  const errors: Partial<Record<ClientField, string>> = {};
  for (const field of Object.keys(clientFieldLimits) as ClientField[]) {
    const entries = formData.getAll(field);
    if (entries.length > 1 || entries.some((entry) => typeof entry !== "string")) {
      errors[field] = "Valeur invalide.";
      continue;
    }
    const value = String(entries[0] ?? "").trim();
    values[field] = value || null;
    if (value.length > clientFieldLimits[field]) errors[field] = `Maximum ${clientFieldLimits[field]} caractères.`;
    if (/\u0000/.test(value)) errors[field] = "Caractère invalide.";
  }
  if (!values.name) errors.name = "Le nom est obligatoire.";
  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) errors.email = "Renseignez une adresse email valide.";
  if (values.website) {
    try {
      const url = new URL(values.website);
      if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password || /\s/.test(values.website)) throw new Error();
    } catch {
      errors.website = "Renseignez une URL complète en http:// ou https://.";
    }
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, data: values as ClientInput };
}
