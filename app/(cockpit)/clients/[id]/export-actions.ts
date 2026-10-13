"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/require-admin";
import { getActiveScenario } from "@/lib/simulation/server";
import { analyzeExportArchive, analyzeExportBatch, cancelExportImport, exportPreview, filterExportItems, importExportBatch, selectExportItems, startExportImport, type PreviewItem } from "@/lib/whatsapp/export-import";
import { exportMessage } from "@/lib/whatsapp/export-messages";

// Socle lot 3 : étapes de l'import d'un export WhatsApp, appelées une à une par la fiche client (admin uniquement).
// Aucune étape ne publie ni ne lit le texte de la conversation au-delà des légendes des photos.
export type ExportStep = { ok: boolean; message?: string; importId?: string; uploadUrl?: string; remaining?: number; imported?: number; done?: boolean; photos?: number; incomplete?: boolean; selected?: number };
const refusal = (code: string): ExportStep => ({ ok: false, message: exportMessage(code) });
async function guard(): Promise<string | ExportStep> {
  const { userId } = await requireAdmin();
  if (await getActiveScenario()) return { ok: false, message: "Import indisponible en simulation." };
  return userId;
}
async function run(work: (userId: string) => Promise<ExportStep>): Promise<ExportStep> {
  const user = await guard(); if (typeof user !== "string") return user;
  try { return await work(user); } catch { console.error("[whatsapp-export] Étape interrompue."); return refusal("unexpected"); }
}
export async function startExportAction(clientId: string, size: number, rightsConfirmed: boolean): Promise<ExportStep> {
  return run(async user => { const r = await startExportImport(user, clientId, size, rightsConfirmed === true); return r.ok ? { ok: true, importId: r.importId, uploadUrl: r.uploadUrl } : refusal(r.code); });
}
export async function analyzeExportAction(clientId: string, importId: string): Promise<ExportStep> {
  return run(async user => { const r = await analyzeExportArchive(user, clientId, importId); return r.ok ? { ok: true, photos: r.photos, incomplete: r.incomplete } : refusal(r.code); });
}
export async function analyzeExportBatchAction(clientId: string, importId: string): Promise<ExportStep> {
  return run(async () => { const r = await analyzeExportBatch(clientId, importId); return r.ok ? { ok: true, remaining: r.remaining } : refusal(r.code); });
}
export type ExportPreviewState = { ok: boolean; message?: string; status?: string; incomplete?: boolean; counts?: Record<string, unknown>; totals?: Record<string, number>; items?: PreviewItem[]; expiresAt?: string };
export async function exportPreviewAction(clientId: string, importId: string, page: number): Promise<ExportPreviewState> {
  const user = await guard(); if (typeof user !== "string") return user;
  try {
    const p = await exportPreview(clientId, importId, Number.isInteger(page) && page >= 0 && page < 100 ? page : 0);
    return p ? { ok: true, status: p.import.status, incomplete: p.import.incomplete, counts: p.import.counts, totals: p.totals, items: p.items, expiresAt: p.import.expires_at } : refusal("import_missing");
  } catch { return refusal("unexpected"); }
}
export async function selectExportItemsAction(clientId: string, importId: string, ids: string[], selected: boolean): Promise<ExportStep> {
  return run(async () => { const r = await selectExportItems(clientId, importId, Array.isArray(ids) ? ids : [], selected === true); return r.ok ? { ok: true } : refusal(r.code); });
}
export async function filterExportItemsAction(clientId: string, importId: string, from: string, to: string, captionOnly: boolean): Promise<ExportStep> {
  return run(async () => { const r = await filterExportItems(clientId, importId, { from: from || null, to: to || null, captionOnly: captionOnly === true }); return r.ok ? { ok: true, selected: r.selected } : refusal(r.code); });
}
export async function importExportBatchAction(clientId: string, importId: string): Promise<ExportStep> {
  return run(async user => {
    const r = await importExportBatch(user, clientId, importId);
    if (!r.ok) return refusal(r.code);
    if (r.done) revalidatePath(`/clients/${clientId}`);
    return { ok: true, remaining: r.remaining, imported: r.imported, done: r.done };
  });
}
export async function cancelExportAction(clientId: string, importId: string): Promise<ExportStep> {
  return run(async user => { const r = await cancelExportImport(user, clientId, importId); return r.ok ? { ok: true, message: "Import annulé : archive supprimée." } : refusal(r.code); });
}
