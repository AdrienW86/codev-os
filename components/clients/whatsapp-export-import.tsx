"use client";
/* eslint-disable @next/next/no-img-element -- Private signed URLs are short-lived and must not be cached by an image proxy. */
import { useCallback, useState } from "react";
import { analyzeExportAction, analyzeExportBatchAction, cancelExportAction, exportPreviewAction, filterExportItemsAction, importExportBatchAction, selectExportItemsAction, startExportAction, type ExportPreviewState } from "@/app/(cockpit)/clients/[id]/export-actions";
import { ITEM_STATUS_LABELS } from "@/lib/whatsapp/export-messages";

// Socle lot 3 : import d'un export de discussion WhatsApp (.zip « avec médias »). L'archive part directement dans un
// stockage privé temporaire, puis tout se fait par petites étapes : analyse, aperçu et sélection, import par lots.
// Rien n'est importé sans la confirmation finale ; rien n'est publié.
type Phase = "idle" | "resume" | "uploading" | "analyzing" | "ready" | "importing" | "done";
const button = "rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-border/40 disabled:opacity-50";
const primary = "rounded-lg bg-accent-strong px-3 py-1.5 text-sm font-semibold text-accent-foreground disabled:opacity-50";
const dateLabel = (iso: string | null) => iso ? new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "Date inconnue";

function upload(url: string, file: File, onProgress: (p: number) => void): Promise<boolean> {
  return new Promise(resolve => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", "application/zip");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.send(file);
  });
}

export function WhatsAppExportImport({ clientId, current, folderReady }: { clientId: string; current: { id: string; status: string } | null; folderReady: boolean }) {
  const [importId, setImportId] = useState<string | null>(current?.id ?? null);
  const [phase, setPhase] = useState<Phase>(current && current.status !== "uploading" ? "resume" : "idle");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [progress, setProgress] = useState(0);
  const [preview, setPreview] = useState<ExportPreviewState | null>(null);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [imported, setImported] = useState(0);
  const fail = useCallback((text?: string) => { setMessage({ ok: false, text: text ?? "Étape interrompue : réessayez." }); setBusy(false); }, []);

  const loadPreview = useCallback(async (id: string, p: number) => {
    const r = await exportPreviewAction(clientId, id, p);
    if (!r.ok) { setMessage({ ok: false, text: r.message ?? "Aperçu indisponible." }); return; }
    setPreview(r);
  }, [clientId]);
  const analyze = useCallback(async (id: string) => {
    setPhase("analyzing"); setBusy(true);
    for (let i = 0; i < 1000; i++) {
      const r = await analyzeExportBatchAction(clientId, id);
      if (!r.ok) return fail(r.message);
      setProgress(r.remaining ?? 0);
      if (!r.remaining) break;
    }
    setBusy(false); setPhase("ready"); await loadPreview(id, 0);
  }, [clientId, loadPreview, fail]);
  const runImport = useCallback(async (id: string) => {
    setPhase("importing"); setBusy(true); setMessage(null);
    let total = 0;
    for (let i = 0; i < 1000; i++) {
      const r = await importExportBatchAction(clientId, id);
      if (!r.ok) return fail(r.message);
      total += r.imported ?? 0; setImported(total); setProgress(r.remaining ?? 0);
      if (r.done) break;
    }
    setBusy(false); setPhase("done"); setImportId(null);
    setMessage({ ok: true, text: `${total} photo${total > 1 ? "s" : ""} importée${total > 1 ? "s" : ""} dans la photothèque. Archive temporaire supprimée.` });
  }, [clientId, fail]);

  // Reprise après rechargement, sur action explicite : on continue là où l'import s'était arrêté.
  async function resume() {
    if (!current) return;
    if (current.status === "analyzing") await analyze(current.id);
    else if (current.status === "importing") await runImport(current.id);
    else { setPhase("ready"); await loadPreview(current.id, 0); }
  }
  async function start(form: FormData) {
    const file = form.get("archive");
    if (!(file instanceof File) || !file.size) return fail("Choisissez l’archive .zip exportée depuis WhatsApp.");
    setBusy(true); setMessage(null);
    const r = await startExportAction(clientId, file.size, form.get("rights") === "on");
    if (!r.ok || !r.importId || !r.uploadUrl) return fail(r.message);
    setImportId(r.importId); setPhase("uploading"); setProgress(0);
    if (!await upload(r.uploadUrl, file, setProgress)) { await cancelExportAction(clientId, r.importId); setPhase("idle"); setImportId(null); return fail("Envoi de l’archive interrompu : réessayez."); }
    const a = await analyzeExportAction(clientId, r.importId);
    if (!a.ok) { setPhase("idle"); setImportId(null); return fail(a.message); }
    await analyze(r.importId);
  }
  async function cancel() {
    if (!importId) return;
    setBusy(true); const r = await cancelExportAction(clientId, importId); setBusy(false);
    if (r.ok) { setPhase("idle"); setImportId(null); setPreview(null); }
    setMessage({ ok: r.ok, text: r.message ?? "" });
  }
  async function toggle(id: string, selected: boolean) {
    if (!importId) return;
    const r = await selectExportItemsAction(clientId, importId, [id], selected);
    if (!r.ok) return fail(r.message);
    await loadPreview(importId, page);
  }
  async function applyFilter(form: FormData) {
    if (!importId) return;
    setBusy(true);
    const r = await filterExportItemsAction(clientId, importId, String(form.get("from") ?? ""), String(form.get("to") ?? ""), form.get("caption_only") === "on");
    setBusy(false);
    if (!r.ok) return fail(r.message);
    setMessage({ ok: true, text: `${r.selected} photo${(r.selected ?? 0) > 1 ? "s" : ""} sélectionnée${(r.selected ?? 0) > 1 ? "s" : ""}.` });
    setPage(0); await loadPreview(importId, 0);
  }

  const totals = preview?.totals ?? {};
  const counts = (preview?.counts ?? {}) as Record<string, number>;
  return <section className="rounded-xl border border-border p-4" data-export-import="true" aria-labelledby="wa-export-title">
    <h3 id="wa-export-title" className="font-semibold">Importer un export WhatsApp</h3>
    <p className="mt-1 text-sm text-muted">Dans WhatsApp : discussion avec le client › Plus › Exporter la discussion › Joindre les médias. Seules les photos, leur date et leur légende sont conservées ; le reste de la conversation n’est jamais enregistré et l’archive est supprimée après l’import (24 h au plus).</p>
    {!folderReady && <p className="mt-3 text-sm text-warning">Associez d’abord un dossier Drive WhatsApp à ce client (Réglages › WhatsApp), avec les droits confirmés.</p>}
    {phase === "idle" && folderReady && <form action={start} className="mt-3 space-y-2 text-sm">
      <input type="file" name="archive" accept=".zip,application/zip" required className="block text-sm" />
      <label className="block"><input type="checkbox" name="rights" required /> Le client m’autorise à utiliser les photos de cette discussion pour ses publications.</label>
      <button disabled={busy} className={primary}>{busy ? "Préparation…" : "Analyser l’archive"}</button>
    </form>}
    {phase === "resume" && current && <div className="mt-3 flex flex-wrap gap-2 text-sm"><p className="w-full">Un import est en cours pour ce client.</p>
      <button className={primary} disabled={busy} onClick={() => void resume()}>Reprendre l’import</button>
      <button className={button} disabled={busy} onClick={() => void cancel()}>Annuler et supprimer l’archive</button></div>}
    {phase === "uploading" && <p className="mt-3 text-sm" role="status">Envoi de l’archive : {progress} %</p>}
    {phase === "analyzing" && <p className="mt-3 text-sm" role="status">Analyse des photos… {progress ? `${progress} restante${progress > 1 ? "s" : ""}` : ""}</p>}
    {phase === "ready" && preview && <div className="mt-3 space-y-3 text-sm">
      <p>{totals.ready ?? 0} photo{(totals.ready ?? 0) > 1 ? "s" : ""} prête{(totals.ready ?? 0) > 1 ? "s" : ""} · {totals.duplicate ?? 0} déjà dans la photothèque · {(totals.invalid ?? 0) + (totals.too_large ?? 0)} écartée{(totals.invalid ?? 0) + (totals.too_large ?? 0) > 1 ? "s" : ""} · {counts.other_files ?? 0} autre{(counts.other_files ?? 0) > 1 ? "s" : ""} fichier{(counts.other_files ?? 0) > 1 ? "s" : ""} ignoré{(counts.other_files ?? 0) > 1 ? "s" : ""} (vidéos, documents, audio)</p>
      {preview.incomplete && <p className="text-warning" data-incomplete="true">Export incomplet{counts.missing ? ` : ${counts.missing} photo${counts.missing > 1 ? "s" : ""} mentionnée${counts.missing > 1 ? "s" : ""} absente${counts.missing > 1 ? "s" : ""} de l’archive` : ""}{counts.omitted ? ` · ${counts.omitted} média${counts.omitted > 1 ? "s" : ""} omis à l’export` : ""}. Les photos présentes peuvent être importées ; pour le reste, refaites l’export « avec médias ».</p>}
      <form action={applyFilter} className="flex flex-wrap items-end gap-2" aria-label="Filtrer la sélection">
        <label className="text-xs">Du<input type="date" name="from" className="ml-1 rounded-md border border-border bg-surface px-2 py-1" /></label>
        <label className="text-xs">au<input type="date" name="to" className="ml-1 rounded-md border border-border bg-surface px-2 py-1" /></label>
        <label className="text-xs"><input type="checkbox" name="caption_only" /> Avec légende seulement</label>
        <button disabled={busy} className={button}>Appliquer</button>
      </form>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{(preview.items ?? []).map(item => <li key={item.id} className={`overflow-hidden rounded-lg border ${item.selected && item.status === "ready" ? "border-accent" : "border-border"}`}>
        <div className="aspect-square bg-surface-raised">{item.preview ? <img src={item.preview} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}</div>
        <div className="space-y-1 p-2 text-xs">
          <p className="text-muted">{dateLabel(item.capturedAt)}</p>
          {item.caption && <p className="line-clamp-3 whitespace-pre-line">{item.caption}</p>}
          {item.status === "ready" ? <label className="block"><input type="checkbox" checked={item.selected} onChange={e => void toggle(item.id, e.target.checked)} /> Importer</label>
            : <p className="text-muted">{ITEM_STATUS_LABELS[item.status] ?? item.status}</p>}
        </div></li>)}</ul>
      <div className="flex flex-wrap items-center gap-2">
        <button className={button} disabled={page === 0} onClick={() => { const p = page - 1; setPage(p); if (importId) void loadPreview(importId, p); }}>Précédentes</button>
        <button className={button} disabled={(preview.items ?? []).length < 60} onClick={() => { const p = page + 1; setPage(p); if (importId) void loadPreview(importId, p); }}>Suivantes</button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={primary} disabled={busy || !totals.selected} onClick={() => importId && void runImport(importId)}>Importer {totals.selected ?? 0} photo{(totals.selected ?? 0) > 1 ? "s" : ""}</button>
        <button className={button} disabled={busy} onClick={() => void cancel()}>Annuler et supprimer l’archive</button>
      </div>
    </div>}
    {phase === "importing" && <div className="mt-3 text-sm" role="status"><p>Import dans Drive et la photothèque… {imported} importée{imported > 1 ? "s" : ""}{progress ? `, ${progress} restante${progress > 1 ? "s" : ""}` : ""}</p>
      {!busy && importId && <button className={`${primary} mt-2`} onClick={() => void runImport(importId)}>Reprendre l’import</button>}</div>}
    {phase === "done" && <button className={`${button} mt-3`} onClick={() => { setPhase("idle"); setMessage(null); setPreview(null); }}>Importer un autre export</button>}
    {message && <p role={message.ok ? "status" : "alert"} className={`mt-3 text-sm ${message.ok ? "text-success" : "text-danger"}`}>{message.text}</p>}
  </section>;
}
