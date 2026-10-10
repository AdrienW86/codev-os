"use client";
import { useState, useTransition } from "react";
import { DEFAULT_RECURRING_CONFIG, type RecurringConfig } from "@/lib/reports/recurring/domain";
import { saveAdsRecurringAction, pauseAdsRecurringAction, prepareAdsRecurringAction } from "@/app/(cockpit)/advertising/recurring-actions";
import type { ReportContent } from "@/lib/reports/build";
export function RecurringEditor({ clientId, initial, revision, campaigns }: { clientId: string; initial: RecurringConfig | null; revision: number; campaigns: { id: string; name: string; type: string }[] }) {
  const [config, setConfig] = useState(initial ?? DEFAULT_RECURRING_CONFIG);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<ReportContent | null>(null);
  const [pending, startTransition] = useTransition();
  const change = <K extends keyof RecurringConfig>(key: K, value: RecurringConfig[K]) => setConfig(old => ({ ...old, [key]: value }));
  const field = "mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3";
  const button = "min-h-11 rounded-lg border border-border px-4 text-sm disabled:opacity-50";
  return <div className="space-y-4">
    <form onSubmit={event => { event.preventDefault(); if (!confirmed) return; startTransition(async () => { const result = await saveAdsRecurringAction(clientId, { ...config, recipientConfirmed: true }, revision); setMessage(result.message ?? ""); }); }}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm">État<select className={field} value={config.enabled ? "enabled" : "paused"} onChange={e => change("enabled", e.target.value === "enabled")}><option value="paused">En pause</option><option value="enabled">Activé</option></select></label>
        <label className="text-sm">Fréquence<select className={field} value={config.frequency} onChange={e => change("frequency", e.target.value as RecurringConfig["frequency"])}><option value="weekly">Hebdomadaire</option><option value="monthly">Mensuelle</option></select></label>
        {config.frequency === "weekly" ? <label className="text-sm">Jour d’échéance<select className={field} value={config.weekday} onChange={e => change("weekday", Number(e.target.value))}>{["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"].map((day,i) => <option key={day} value={i+1}>{day}</option>)}</select></label> : <label className="text-sm">Jour du mois<input type="number" min={1} max={31} required className={field} value={config.monthDay} onChange={e => change("monthDay", Number(e.target.value))} /><span className="mt-1 block text-xs text-muted">Jour absent : dernier jour du mois.</span></label>}
        <label className="text-sm">Heure locale<input type="time" required className={field} value={config.time} onChange={e => change("time",e.target.value)} /></label>
        <label className="text-sm">Fuseau de planification<input required maxLength={64} className={field} value={config.timezone} onChange={e => change("timezone",e.target.value)} /></label>
        <label className="text-sm">Préparer avant l’échéance (heures)<input type="number" min={0} max={72} required className={field} value={config.leadHours} onChange={e => change("leadHours",Number(e.target.value))} /></label>
        <label className="text-sm">Analyse<select className={field} value={config.mode} onChange={e => change("mode",e.target.value as RecurringConfig["mode"])}><option value="ai">IA personnalisée (repli visible)</option><option value="deterministic">Règles déterministes, sans IA</option></select></label>
        <label className="text-sm">Transport<select className={field} value={config.transport} onChange={e => change("transport",e.target.value as RecurringConfig["transport"])}><option value="prepare_only">Préparation seule</option><option value="approved_auto">Envoi automatique de la version approuvée</option></select></label>
        <label className="text-sm">Retard maximal autorisé (minutes)<input type="number" min={0} max={120} required className={field} value={config.lateMinutes} onChange={e => change("lateMinutes",Number(e.target.value))} /><span className="mt-1 block text-xs text-muted">0 = aucun retard. Au-delà : envoi manuel obligatoire.</span></label>
        <label className="text-sm sm:col-span-2">Adresse destinataire explicitement choisie<input type="email" required maxLength={320} className={field} value={config.recipient} onChange={e => { change("recipient",e.target.value); setConfirmed(false); }} /></label>
      </div>
      <fieldset className="mt-4"><legend className="text-sm font-medium">Campagnes incluses (périmètre figé pour chaque échéance)</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{campaigns.map(c => <label key={c.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={config.campaignIds.includes(c.id)} onChange={e => change("campaignIds", e.target.checked ? [...config.campaignIds,c.id] : config.campaignIds.filter(id => id !== c.id))} />{c.name} · {c.type}</label>)}</div>{!campaigns.length && <p className="text-sm text-muted">Connectez Google Ads pour choisir les campagnes.</p>}</fieldset>
      <fieldset className="mt-3"><legend className="text-sm">Types (aucun filtre = tous les types sélectionnés)</legend><div className="flex flex-wrap gap-4">{[...new Set(campaigns.map(c => c.type))].map(type => <label key={type} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={config.types.includes(type)} onChange={e => change("types",e.target.checked ? [...config.types,type] : config.types.filter(t => t !== type))} />{type}</label>)}</div></fieldset>
      <label className="my-4 flex items-start gap-2 text-sm"><input type="checkbox" required checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Je vérifie que cette adresse appartient au destinataire souhaité et confirme le périmètre et la règle de retard. L’envoi automatique exige toujours une approbation distincte du contenu.</label>
      <button disabled={pending || !confirmed || !config.campaignIds.length} className={button}>{pending ? "Enregistrement…" : "Enregistrer la configuration"}</button>
    </form>
    {initial && <div className="flex flex-wrap gap-3"><button className={button} disabled={pending} onClick={() => startTransition(async () => { setPreview(null); setMessage("Préparation ou lecture de l’aperçu en cours…"); try { const result = await prepareAdsRecurringAction(clientId); setMessage(result.message ?? ""); setPreview(result.preview ?? null); } catch { setMessage("Préparation indisponible. Réessayez."); } })}>Préparer maintenant / voir l’aperçu</button><button className={button} disabled={pending || !initial.enabled} onClick={() => startTransition(async () => { const result = await pauseAdsRecurringAction(clientId); setMessage(result.message ?? ""); })}>Mettre en pause</button></div>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {preview && <section className="rounded-lg border border-border p-4"><h3 className="font-semibold">Aperçu provisoire — non approuvable, non envoyable</h3><p className="mt-2 text-sm">{preview.summary}</p>{preview.sections.map(section => <div key={section.title} className="mt-4"><h4 className="font-medium">{section.title}</h4><ul className="text-sm">{section.lines.map((line,i) => <li key={i}>{line}</li>)}</ul></div>)}</section>}
  </div>;
}
