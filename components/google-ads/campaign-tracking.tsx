"use client";
import { useRef, useState } from "react";
import type { CampaignRow } from "@/lib/integrations/google-ads/dashboard";
import type { CampaignTracking } from "@/lib/integrations/google-ads/tracking";

export type SaveTracking = (clientId: string, ids: string[], revision: number) => Promise<{ ok: boolean; message: string }>;

export function CampaignTrackingEditor({ clientId, rows, tracking, save, refresh }: { clientId: string; rows: CampaignRow[]; tracking: CampaignTracking; save: SaveTracking; refresh: () => void }) {
  const [ids, setIds] = useState(tracking.ids ?? rows.map((row) => row.id));
  const [state, setState] = useState({ pending: false, message: "" });
  const busy = useRef(false);
  if (!tracking.available) return <p role="status" className="text-sm text-amber-200">Suivi persistant indisponible : migration 20261017000000 requise. Le dashboard consulte le compte entier.</p>;
  return <details className="mb-4 rounded-xl border border-border bg-surface p-4">
    <summary className="min-h-10 cursor-pointer font-medium">Campagnes suivies pour ce client {tracking.ids === null ? "(à configurer)" : `(${tracking.ids.length})`}</summary>
    <p className="mt-2 text-sm text-muted">Cette sélection est enregistrée pour le dashboard, l’assistant et les analyses. Elle reste distincte des filtres d’affichage et ne modifie aucune campagne Google Ads.</p>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">{rows.map((row) => <label key={row.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" disabled={state.pending} checked={ids.includes(row.id)} onChange={(event) => setIds((current) => event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id))} />{row.name}</label>)}</div>
    {tracking.ids?.some((id) => !rows.some((row) => row.id === id)) && <p className="mt-2 text-sm text-amber-200">Certaines campagnes suivies ne sont plus disponibles. Retirez-les avant d’enregistrer.</p>}
    <button type="button" onClick={() => setIds([])} disabled={state.pending} className="mt-3 min-h-11 px-3 text-sm text-muted">Ne suivre aucune campagne</button>
    <button type="button" disabled={state.pending || ids.length > 50} className="mt-3 min-h-11 rounded-lg border border-border px-4 text-sm" onClick={async () => {
      if (busy.current) return;
      busy.current = true; setState({ pending: true, message: "" });
      try { const result = await save(clientId, ids, tracking.revision); setState({ pending: false, message: result.message }); if (result.ok) refresh(); }
      catch { setState({ pending: false, message: "Enregistrement impossible. Rechargez la page." }); }
      finally { busy.current = false; }
    }}>{state.pending ? "Enregistrement…" : "Enregistrer les campagnes suivies"}</button>
    {ids.length > 50 && <p role="alert">50 campagnes maximum.</p>}
    {state.message && <p role="status" className="mt-2 text-sm">{state.message}</p>}
  </details>;
}
