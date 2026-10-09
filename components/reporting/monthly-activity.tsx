import Link from "next/link";
import { actionTypeLabel, recommendationStatusLabel, runStatusLabel } from "@/lib/presentation/labels";
import type {SummaryActivity} from "@/lib/reporting/types";
export function MonthlyActivity({activity}:{activity:SummaryActivity}) {
 return <div className="mt-4 space-y-4 text-sm">
  <p>{activity.runs.length} analyses · {activity.completedTasks.length} tâches terminées · {activity.executedActions.length} actions exécutées</p>
  <p>Publications : {activity.scheduled.length} dates programmées · {activity.published.length} diffusions · {activity.failed.length} erreurs actuelles · {activity.incidents.length} incidents</p>
  <details><summary className="cursor-pointer">Réalisations, recommandations et actions à venir</summary>
   <ul className="mt-3 space-y-2">{activity.completedTasks.map(t=><li key={`task:${t.id}`}><Link href={`/tasks/${t.id}/edit`}>{t.title} — terminée</Link></li>)}{activity.executedActions.map(a=><li key={`action:${a.id}`}>{actionTypeLabel(a.action_type)} — réalisée</li>)}{activity.runs.map(r=><li key={`run:${r.id}`}><Link href={`/agents/${r.agent_id}`}>Analyse · {runStatusLabel(r.status).label.toLowerCase()}</Link> — {r.summary??"Sans résumé"}</li>)}{activity.recommendations.map(r=><li key={`rec:${r.id}`}><Link className="text-accent" href={`/recommendations/${r.id}`}>{r.title}</Link> — {recommendationStatusLabel(r.status).label.toLowerCase()}</li>)}</ul>
   <h4 className="mt-4 font-medium">À venir, selon l’état actuel</h4><ul className="mt-2 space-y-2">{activity.upcomingTasks.map(t=><li key={t.id}>{t.title} — {t.due_date}</li>)}{activity.openRecommendations.map(r=><li key={r.id}><Link href={`/recommendations/${r.id}`}>{r.title}</Link> — {recommendationStatusLabel(r.status).label.toLowerCase()}</li>)}</ul>
  </details>
  <details><summary className="cursor-pointer">Publications et incidents</summary><ul className="mt-3 space-y-2">{activity.scheduled.map(d=><li key={`scheduled:${d.id}`}>{d.platform} — programmée le {d.scheduled_for} — {d.status}</li>)}{activity.published.map(d=><li key={`published:${d.id}`}>{d.platform} — diffusée le {d.published_at}</li>)}{activity.failed.map(d=><li key={`failed:${d.id}`}>{d.platform} — {d.status}</li>)}{activity.incidents.map(i=><li key={`${i.source}:${i.id}`}>{i.source} — {i.status} — {i.occurred_at}</li>)}</ul></details>
  <div><h4 className="font-medium">Métriques enregistrées</h4>{activity.metrics.length ? activity.metrics.map(m=><div key={`${m.account_id}:${m.period.start}:${m.period.end}`} className="mt-2"><p>Google Ads · {m.account_id} · {m.period.start} → {m.period.end} · {m.coverage==="full_month"?"Mois complet":"Période partielle"} · {m.currency??"Devise inconnue"}</p><dl className="mt-2 flex flex-wrap gap-4">{Object.entries(m.values).map(([key,value])=><div key={key}><dt className="text-xs text-muted">{key}</dt><dd>{value}</dd></div>)}</dl></div>) : <p className="mt-2 text-muted">Aucune métrique persistée pour cette période.</p>}</div>
 </div>;
}
