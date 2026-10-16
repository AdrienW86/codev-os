"use client";

import { useEffect, useRef, useState } from "react";
import { prepareManualExport, tryCopyPublicationText, type ManualExportInput } from "@/lib/publications/manual-export";

type CopyState = { platform: string; text: string; state: "copying" | "copied" | "fallback" } | null;

export function PublicationManualExport({ className = "", ...input }: ManualExportInput & { className?: string }) {
  const [copy, setCopy] = useState<CopyState>(null), [downloadError, setDownloadError] = useState("");
  const busy = useRef(false), fallback = useRef<HTMLTextAreaElement>(null);
  let prepared: ReturnType<typeof prepareManualExport> | null = null, error = "";
  try { prepared = prepareManualExport(input); } catch (failure) { error = failure instanceof Error ? failure.message : "Textes indisponibles."; }
  const activeCopy = prepared?.variants.find(variant => variant.platform === copy?.platform && variant.text === copy.text);
  const fallbackSelection = copy?.state === "fallback" && activeCopy ? `${activeCopy.platform}:${activeCopy.text}` : null;
  useEffect(() => {
    if (fallbackSelection !== null) { fallback.current?.focus(); fallback.current?.select(); }
  }, [fallbackSelection]);

  async function copyText(platform: string, text: string) {
    if (busy.current) return;
    busy.current = true; setCopy({ platform, text, state: "copying" });
    try {
      const copied = await tryCopyPublicationText(text, typeof navigator === "undefined" ? undefined : navigator.clipboard);
      setCopy({ platform, text, state: copied ? "copied" : "fallback" });
    } catch {
      // Accessing navigator.clipboard can itself be denied by a browser policy.
      setCopy({ platform, text, state: "fallback" });
    } finally { busy.current = false; }
  }

  function download() {
    if (!prepared) return;
    setDownloadError("");
    let url: string | null = null;
    try {
      url = URL.createObjectURL(new Blob([prepared.content], { type: "text/plain;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url; link.download = prepared.filename; document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); }
    } catch { setDownloadError("Téléchargement indisponible. Copiez les textes de chaque réseau ci-dessous."); }
    finally { if (url) { const temporaryUrl = url; setTimeout(() => URL.revokeObjectURL(temporaryUrl), 1000); } }
  }

  return <section className={`min-w-0 rounded-lg border border-border p-4 ${className}`} data-publication-manual-export="true">
    <h3 className="font-semibold">Récupérer les textes</h3>
    <p className="mt-2 text-xs text-muted">Cette copie correspond à la version enregistrée. Enregistrez vos modifications avant de copier.</p>
    <p className="mt-1 text-xs text-muted">Le titre public, le texte et le CTA sont inclus lorsqu’ils sont renseignés. La récupération des textes ne publie rien.</p>
    {!input.approved && <p className="mt-2 text-sm text-warning" role="note">Version non approuvée : faites-la valider avant toute publication.</p>}
    {!prepared ? <p className="mt-3 text-sm text-muted" role="status">{error}</p> : <>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={download} className="rounded-lg border border-border px-3 py-2 text-sm">Télécharger les textes</button>
        <span className="text-xs text-muted">{prepared.version} · fichier .txt UTF-8</span>
      </div>
      {downloadError && <p className="mt-2 text-sm text-danger" role="alert">{downloadError}</p>}
      <div className="mt-3 space-y-3">{prepared.variants.map(variant => {
        const state = activeCopy?.platform === variant.platform ? copy?.state : null;
        return <fieldset key={variant.platform} className="min-w-0 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-medium">{variant.label}</legend>
          <button type="button" disabled={copy?.state === "copying"} onClick={() => void copyText(variant.platform, variant.text)}
            className="rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-50">{state === "copying" ? "Copie…" : "Copier le texte"}</button>
          {state === "copied" && <p className="mt-2 text-xs text-muted" role="status">Texte copié.</p>}
          {state === "fallback" && <div className="mt-2 space-y-2">
            <p className="text-sm" role="status">Copie automatique indisponible. Sélectionnez et copiez le texte ci-dessous.</p>
            <label className="block text-xs">Texte à copier manuellement — {variant.label}
              <textarea ref={fallback} readOnly value={variant.text} onFocus={event => event.currentTarget.select()} rows={7}
                className="mt-1 block w-full min-w-0 rounded-lg border border-border bg-background p-2 text-sm [overflow-wrap:anywhere]"/>
            </label>
          </div>}
        </fieldset>;
      })}</div>
    </>}
  </section>;
}
