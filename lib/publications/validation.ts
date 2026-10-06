import { publicationPlatforms, type ManualVariantInput, type ManualPublicationInput, type RevisePublicationInput, type ReviewPublicationInput, type WeeklySlot } from "./types";

export function isPublicationUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function cleanText(value: unknown, maximum: number): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) ? value.trim() : null;
}
export function isEditorialWeek(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && date.getUTCDay() === 1;
}
export function validateWeeklySlots(value: unknown): value is [WeeklySlot, WeeklySlot] {
  return Array.isArray(value) && value.length === 2 && value.every((item) => record(item)
    && exactKeys(item, ["day", "time"]) && Number.isInteger(item.day) && Number(item.day) >= 1 && Number(item.day) <= 7
    && typeof item.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(item.time))
    && (value[0].day !== value[1].day || value[0].time !== value[1].time);
}
export function validateTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 100) return false;
  try { new Intl.DateTimeFormat("fr-FR", { timeZone: value }); return true; } catch { return false; }
}
export function validateVariants(value: unknown): ManualVariantInput[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) return null;
  const variants: ManualVariantInput[] = [];
  for (const item of value) {
    if (!record(item) || !exactKeys(item, ["platform", "text_content", "asset_ids"])) return null;
    const platform = publicationPlatforms.find((candidate) => candidate === item.platform);
    const text = cleanText(item.text_content, 10000);
    const assets = item.asset_ids ?? [];
    if (!platform || !text || variants.some((variant) => variant.platform === platform)
      || !Array.isArray(assets) || assets.length > 10 || !assets.every(isPublicationUuid) || new Set(assets).size !== assets.length) return null;
    variants.push({ platform, text_content: text, asset_ids: assets });
  }
  return variants;
}
export function validateManualPublication(value: unknown): ManualPublicationInput | null {
  if (!record(value) || !exactKeys(value, ["project_id", "client_id", "editorial_week", "slot", "subject", "variants"])) return null;
  if (value.project_id != null && !isPublicationUuid(value.project_id)) return null;
  const subject = cleanText(value.subject, 300), variants = validateVariants(value.variants);
  if (!isPublicationUuid(value.client_id) || !isEditorialWeek(value.editorial_week) || (value.slot !== 1 && value.slot !== 2) || !subject || !variants) return null;
  return { ...(value.project_id ? {project_id:value.project_id as string} : {}), client_id: value.client_id, editorial_week: value.editorial_week, slot: value.slot, subject, variants };
}
export function validateRevision(value: unknown): RevisePublicationInput | null {
  if (!record(value) || !exactKeys(value, ["publication_id", "expected_revision_id", "variants"])) return null;
  const variants = validateVariants(value.variants);
  return isPublicationUuid(value.publication_id) && isPublicationUuid(value.expected_revision_id) && variants
    ? { publication_id: value.publication_id, expected_revision_id: value.expected_revision_id, variants } : null;
}
export function validateReview(value: unknown): ReviewPublicationInput | null {
  if (!record(value) || !exactKeys(value, ["publication_id", "revision_id", "variant_id", "decision", "reason"])) return null;
  const reason = value.reason === undefined || value.reason === null || value.reason === "" ? null : cleanText(value.reason, 3000);
  if (!isPublicationUuid(value.publication_id) || !isPublicationUuid(value.revision_id) || !isPublicationUuid(value.variant_id)
    || (value.decision !== "approved" && value.decision !== "rejected")
    || (value.decision === "rejected" && !reason) || (value.reason != null && value.reason !== "" && !reason)) return null;
  return { publication_id: value.publication_id, revision_id: value.revision_id, variant_id: value.variant_id, decision: value.decision, reason };
}
