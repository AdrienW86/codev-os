"use client";
import { useState, useTransition } from "react";
import { saveAutopilotModeAction, undoAutopilotChangeAction } from "@/app/(cockpit)/advertising/autopilot-actions";

type Change = { id: string; campaign_id: string; keyword: string; match_type: string; reason: string; status: string; created_at: string; applied_at: string | null };
type Props = { clientId: string; clientName: string; available: boolean; serverEnabled: boolean; mode: "off" | "negatives" | "extended"; maxPerCampaignWeek: number; changes: Change[] | null };

const statusLabels: Record<string, string> = { applied: "Appliqué", undone: "Annulé", uncertain: "À vérifier dans Google Ads", pending: "En cours", failed: "Échec" };
const reasonLabels: Record<string, string> = { client_exclusion: "Exclusion déclarée par le client", off_target_waste: "Hors cible, dépenses sans conversion" };

export function AutopilotPanel(props: Props) {
  const [mode, setMode] = useState(props.mode);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const save = (next: string) => start(async () => { const result = await saveAutopilotModeAction(props.clientId, next); setMessage(result.message); if (result.ok) setMode(next as Props["mode"]); });
  const undo = (id: string) => start(async () => { const result = await undoAutopilotChangeAction(id); setMessage(result.message); });
  return <section className="mt-6 space-y-4 rounded-xl border border-border p-5" aria-label="Pilote automatique Google Ads">
    <div>
      <h3 className="font-semibold">Pilote automatique — {props.clientName}</h3>
      <p className="mt-1 text-sm text-muted">À chaque veille quotidienne, l’agent ajoute seul des mots-clés négatifs exacts sur les recherches hors cible : exclusions que vous avez déclarées, ou termes coûteux sans conversion sans lien avec vos services. {props.maxPerCampaignWeek} au plus par campagne et par semaine. Mots-clés, budgets et enchères restent des propositions à valider. Chaque ajout est journalisé et annulable.</p>
    </div>
    {!props.available ? <p className="text-sm text-warning">Migration 20261205000000_ads_autopilot à appliquer avant d’activer le pilote.</p> : <>
      {!props.serverEnabled && <p className="text-sm text-warning">Écritures désactivées côté serveur : le pilote ne modifiera rien tant que CODEV_GOOGLE_ADS_WRITES_ENABLED et CODEV_GOOGLE_ADS_AUTOPILOT ne valent pas « true ».</p>}
      <fieldset className="flex flex-wrap gap-2" disabled={pending}>
        <legend className="sr-only">Mode</legend>
        {[["off", "Désactivé"], ["negatives", "Négatifs automatiques"]].map(([value, label]) => <button key={value} type="button" onClick={() => save(value)} aria-pressed={mode === value}
          className={`min-h-10 rounded-lg border px-4 text-sm ${mode === value ? "border-accent bg-accent/15 font-medium" : "border-border"}`}>{label}</button>)}
      </fieldset>
    </>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {props.changes && props.changes.length > 0 && <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-muted"><tr><th className="py-1 pr-3 font-medium">Date</th><th className="py-1 pr-3 font-medium">Campagne</th><th className="py-1 pr-3 font-medium">Mot-clé négatif</th><th className="py-1 pr-3 font-medium">Raison</th><th className="py-1 pr-3 font-medium">État</th><th /></tr></thead>
        <tbody>{props.changes.map((change) => <tr key={change.id} className="border-t border-border">
          <td className="py-2 pr-3">{change.created_at.slice(0, 10)}</td><td className="py-2 pr-3">{change.campaign_id}</td>
          <td className="py-2 pr-3">[{change.keyword}]</td><td className="py-2 pr-3">{reasonLabels[change.reason] ?? change.reason}</td>
          <td className="py-2 pr-3">{statusLabels[change.status] ?? change.status}</td>
          <td className="py-2">{change.status === "applied" && <button type="button" disabled={pending} onClick={() => undo(change.id)} className="rounded-lg border border-border px-3 py-1">Annuler</button>}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </section>;
}
