import Link from "next/link";
import { emailSendingStatus } from "@/lib/providers/email";
import { recurringOverview } from "@/lib/reports/recurring/service";
import { recurringConfigSchema } from "@/lib/reports/recurring/domain";
import { RecurringEditor } from "./recurring-editor";
export async function RecurringReportsPanel({ clientId, campaigns }: { clientId: string; campaigns: { id: string; name: string; type: string }[] }) {
  const overview = await recurringOverview(clientId);
  if (!overview.available) return <section className="mt-6 rounded-xl border border-border p-4"><h2 className="font-semibold">Rapports Ads récurrents</h2><p role="status" className="mt-2 text-sm">{overview.message}</p></section>;
  const config = overview.settings ? recurringConfigSchema.parse(overview.settings.config) : null;
  const email = emailSendingStatus();
  const timezone = config?.timezone ?? "Europe/Paris";
  const date = (value: string) => new Date(value).toLocaleString("fr-FR", { timeZone: timezone });
  const window = overview.nextWindow;
  const labels: Record<string,string> = { pending: "Envoi prévu", blocked: "Envoi bloqué : validation nécessaire", late: "Échéance dépassée : envoi manuel", paused: "Envoi en pause", accepted: "Accepté par Resend, livraison non confirmée", failed: "Envoi refusé", uncertain: "Résultat incertain : vérifier Resend", prepare_only: "Préparation seule" };
  return <section className="mt-6 space-y-5 rounded-xl border border-border p-4" id="recurring-reports"><h2 className="font-semibold">Rapports Ads récurrents par client</h2>
    {overview.settings && config && <div className="text-sm"><p>{config.enabled ? "Activé" : "En pause"} · {config.frequency === "weekly" ? "Hebdomadaire" : "Mensuel"} · {timezone}</p><p>Prochaine préparation : {date(overview.settings.next_prepare_at)}</p><p>Prochaine échéance : {date(overview.settings.next_due_at)} · {config.transport === "approved_auto" ? "Envoi de la version approuvée uniquement" : "Aucun envoi automatique"}</p>{window && <p>Période : {window.start} → {window.end} · coupure : {window.cutoff}</p>}</div>}
    {config?.transport === "approved_auto" && !email.enabled && <p role="status" className="text-sm">Envoi automatique indisponible : {email.reason}</p>}
    <p className="text-xs text-muted">Périodes entre deux préparations, avec uniquement les journées closes du compte Ads. Après modification ou pause, reprise après le dernier jour finalisé du même compte et fuseau.</p>
    <RecurringEditor key={`${clientId}:${overview.settings?.revision ?? 0}`} clientId={clientId} initial={config} revision={overview.settings?.revision ?? 0} campaigns={campaigns} />
    <div><h3 className="font-medium">Rapport en cours et historique</h3>{!overview.occurrences.length ? <p className="mt-2 text-sm text-muted">Aucun rapport préparé. L’aperçu provisoire reste distinct de la version finalisée.</p> : <ul className="mt-3 space-y-4">{overview.occurrences.map(o => { const c=recurringConfigSchema.parse(o.config); const w=o.period_window as unknown as { start:string;end:string;cutoff:string }; return <li key={o.id} className="rounded-lg border border-border p-3 text-sm"><p>{w.start} → {w.end} · {c.timezone} · échéance {date(o.due_at)}</p><p>Destinataire figé : {c.recipient}</p><p>{o.report ? `Version ${o.report.version} · ${o.report.status === "approved" ? "Approuvée et envoyable" : o.report.status === "sent" ? "Envoyée, figée" : "Finalisée, à relire"} · actualisée ${o.report.generated_at ? date(o.report.generated_at) : "—"}` : o.preparation === "cancelled" ? "Préparation annulée : pause ou configuration remplacée" : o.preparation === "failed" ? "Préparation échouée : consulter les jobs du planificateur" : "Préparation en file"}</p><p>{o.report?.status === "sent" ? "Envoi consigné ; consulter le rapport pour le suivi de livraison" : labels[o.transport] ?? o.transport}</p><p className="text-xs text-muted">Coupure : {w.cutoff}</p>{o.report && <div className="mt-2 flex flex-wrap gap-4"><Link className="min-h-11 py-2 text-accent" href={`/reports/${o.report_id}`}>Voir le rapport en cours</Link>{o.report.status === "approved" && <Link className="min-h-11 py-2 text-accent" href={`/reports/${o.report_id}#send-report`}>Envoyer maintenant (prévisualisation)</Link>}</div>}</li>; })}</ul>}</div>
  </section>;
}
