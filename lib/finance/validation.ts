// Validation monétaire exacte en centimes : jamais de Float pour l'argent.
export class FinanceInputError extends Error {
  constructor(message: string) { super(message); this.name = "FinanceInputError"; }
}
export const financeUnits = ["forfait","projet","article","support","dossier","heure","mois","an","mise_en_place"] as const;
export const financeFrequencies = ["ponctuel","mensuel","annuel"] as const;
export const financeStatuses = ["draft","active","paused","ended"] as const;
export const financeUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function field(form: FormData, key: string, max = 3000): string {
  const values = form.getAll(key);
  if (values.length > 1 || values.some((value) => typeof value !== "string")) throw new FinanceInputError("Champ invalide : " + key);
  const value = typeof values[0] === "string" ? values[0].trim() : "";
  if (value.length > max || value.includes("\0")) throw new FinanceInputError("Champ trop long ou invalide : " + key);
  return value;
}
export function textRequired(input: string, label: string, min = 2): string {
  if (input.length < min) throw new FinanceInputError(label + " requis.");
  return input;
}
export function cents(input: string, required = false): number | null {
  if (!input) { if (required) throw new FinanceInputError("Prix contractuel requis."); return null; }
  const normalized = input.replace(",", ".");
  if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(normalized)) throw new FinanceInputError("Montant invalide : 0 à 9 999 999,99 €.");
  const [euros,decimal = ""] = normalized.split(".");
  const total = Number(euros) * 100 + Number(decimal.padEnd(2, "0"));
  if (!Number.isSafeInteger(total)) throw new FinanceInputError("Montant invalide.");
  return total;
}
export function quantity(input: string): number {
  if (!/^(?:[1-9]\d{0,4}|0\.\d{1,2}|[1-9]\d{0,4}\.\d{1,2})$/.test(input.replace(",", "."))) throw new FinanceInputError("Quantité invalide.");
  const q = Number(input.replace(",", "."));
  if (!(q > 0 && q <= 100000)) throw new FinanceInputError("Quantité invalide.");
  return q;
}
export function isoDay(input: string, required: boolean): string | null {
  if (!input) { if (required) throw new FinanceInputError("Date de début requise."); return null; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input) || !Number.isFinite(Date.parse(input)) || new Date(input).toISOString().slice(0,10) !== input)
    throw new FinanceInputError("Date invalide.");
  return input;
}
export function enumValue<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value as T)) throw new FinanceInputError(label + " invalide.");
  return value as T;
}
