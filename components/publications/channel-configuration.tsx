'use client';
import {useActionState,useState} from 'react';
import {Badge,Panel} from '@/components/ui/primitives';
import {confirmChannelsAction,saveChannelScheduleAction,setChannelEnabledAction,type ConfigurationState} from '@/app/(cockpit)/publications/configuration-actions';
import {DEFAULT_SCHEDULE_TIMEZONE,MAX_SCHEDULE_SLOTS,WEEKDAY_LABELS,postsPerWeekLabel,scheduleSlotsPayload,slotRowsError,sortConfigurationSlots,weekdayLabel,
 type ChannelCard,type ChannelConfigurationView,type ConfigurationSlot} from '@/lib/publications/channel-configuration-model';

// Project "Configuration" tab (Lot 4.3 P2-b): explicit channels and their weekly schedules. No identifier is
// rendered or sent: forms carry the project and the platform, the server resolves the channel.
const input='rounded-lg border border-border bg-background p-2 text-sm';
const stateBadges={legacy:<Badge tone="amber">Configuration héritée</Badge>,active:<Badge tone="green">Actif</Badge>,inactive:<Badge>Inactif</Badge>};
const initial:ConfigurationState={};

export function ChannelConfiguration({projectId,view}:{projectId:string;view:ChannelConfigurationView|null}){
 if(!view)return <Panel className="mt-6 p-6"><h2 className="font-semibold">Configuration des publications</h2><p role="alert" className="mt-3 text-sm">Configuration des canaux indisponible pour le moment. Rechargez la page.</p></Panel>;
 return <>
  <Panel className="mt-6 p-6"><h2 className="font-semibold">Configuration des publications</h2>
   <p className="mt-2 text-sm text-muted">Canaux de diffusion du projet et planning hebdomadaire de chacun. Le nombre de publications par semaine découle des créneaux actifs. Aucune publication n’est diffusée depuis cette page.</p>
   {view.legacy&&<LegacyBanner projectId={projectId}/>}
   {view.suspended&&<p role="status" data-channel-state="suspended" className="mt-4 rounded-lg border border-amber-500 p-3 text-sm">{view.suspended}</p>}
   {view.calendarNotice&&<p role="status" data-channel-transition="calendar" className="mt-4 rounded-lg border border-border p-3 text-sm">{view.calendarNotice}</p>}
   {view.agentNotice&&<p role="status" data-channel-transition="agent" className="mt-4 rounded-lg border border-border p-3 text-sm">{view.agentNotice}</p>}
  </Panel>
  <div className="mt-6 grid gap-6 lg:grid-cols-3">{view.cards.map(card=><ChannelCardView key={card.platform} projectId={projectId} card={card}/>)}</div></>;
}

function LegacyBanner({projectId}:{projectId:string}){
 const [state,confirm,pending]=useActionState(confirmChannelsAction,initial);
 return <form action={confirm} data-legacy-banner="true" className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-500 p-3 text-sm"><input type="hidden" name="project_id" value={projectId}/>
  <Badge tone="amber">Configuration héritée</Badge><span className="flex-1">Ces canaux sont déduits du type du projet. Confirmez-les pour les activer, les désactiver et planifier chacun d’eux.</span>
  <button disabled={pending} className="rounded-lg bg-accent px-4 py-2 font-semibold text-background">{pending?'Confirmation…':'Confirmer / personnaliser les canaux'}</button>
  {state.message&&<p role="status" className="w-full">{state.message}</p>}</form>;
}

function ChannelCardView({projectId,card}:{projectId:string;card:ChannelCard}){
 return <Panel className="p-5" ><article data-channel={card.platform} data-state={card.state}>
  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{card.label}</h3>{stateBadges[card.state]}</div>
  <p className="mt-2 text-xs text-muted">{card.accountConnected?'Compte connecté':'Aucun compte connecté'}</p>
  {card.rules&&<div className="mt-3 text-sm"><p className="text-xs text-muted">Règles éditoriales</p><p className="whitespace-pre-wrap">{card.rules}</p></div>}
  {card.state!=='legacy'&&<ChannelToggle projectId={projectId} card={card}/>}
  {card.state==='legacy'?<p className="mt-4 text-sm text-muted">Confirmez les canaux pour configurer le planning.</p>
   :!card.configured?<p className="mt-4 text-sm text-muted">Activez ce canal pour configurer son planning.</p>
   :<ScheduleEditor key={JSON.stringify(card.schedule)} projectId={projectId} card={card}/>}
 </article></Panel>;
}

function ChannelToggle({projectId,card}:{projectId:string;card:ChannelCard}){
 const [state,toggle,pending]=useActionState(setChannelEnabledAction,initial);const active=card.state==='active';
 return <form action={toggle} className="mt-4 flex flex-wrap items-center gap-3"><input type="hidden" name="project_id" value={projectId}/><input type="hidden" name="platform" value={card.platform}/>
  <input type="hidden" name="enabled" value={active?'false':'true'}/>
  <button disabled={pending} className="rounded-lg border border-border px-3 py-2 text-sm">{pending?'Enregistrement…':active?'Désactiver le canal':'Activer le canal'}</button>
  {state.message&&<p role="status" className={`text-sm ${state.ok?'':'text-red-400'}`}>{state.message}</p>}</form>;
}

type Row=ConfigurationSlot&{key:number};
function ScheduleEditor({projectId,card}:{projectId:string;card:ChannelCard}){
 const schedule=card.schedule;
 const [enabled,setEnabled]=useState(schedule?.enabled??true);
 const [rows,setRows]=useState<Row[]>(()=>(schedule?.slots??[]).map((s,i)=>({...s,key:i})));
 const [next,setNext]=useState(rows.length);
 const [state,save,pending]=useActionState(saveChannelScheduleAction,initial);
 const timezone=schedule?.timezone??DEFAULT_SCHEDULE_TIMEZONE,sorted=sortConfigurationSlots(rows),error=slotRowsError(rows);
 const restorable=(schedule?.inactiveSlots??[]).filter(s=>!rows.some(r=>r.weekday===s.weekday&&r.localTime===s.localTime));
 const add=(slot?:ConfigurationSlot)=>{if(rows.length>=MAX_SCHEDULE_SLOTS)return;
  const free=slot??{weekday:[1,2,3,4,5,6,7].find(d=>!rows.some(r=>r.weekday===d&&r.localTime==='12:00'))??1,localTime:'12:00'};setRows([...rows,{...free,key:next}]);setNext(next+1);};
 const update=(key:number,patch:Partial<ConfigurationSlot>)=>setRows(rows.map(r=>r.key===key?{...r,...patch}:r));
 return <form action={save} className="mt-5 space-y-3 border-t border-border pt-4"><input type="hidden" name="project_id" value={projectId}/><input type="hidden" name="platform" value={card.platform}/>
  <input type="hidden" name="timezone" value={timezone}/><input type="hidden" name="slots" value={JSON.stringify(scheduleSlotsPayload(rows))}/>
  <div className="flex flex-wrap items-center justify-between gap-2"><label className="text-sm"><input type="checkbox" name="enabled" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/> Planning actif</label>
   {!enabled&&<Badge>Planning désactivé</Badge>}</div>
  {card.state==='inactive'&&<p className="text-xs text-amber-300">Canal inactif : ce planning est conservé mais n’est pas utilisé.</p>}
  <p className="text-xs text-muted">Fuseau horaire <span className="text-foreground">{timezone}</span></p>
  {sorted.length?<ul className="space-y-2">{sorted.map(r=><li key={r.key} className="flex flex-wrap items-center gap-2" data-slot-row="true">
   <select aria-label="Jour" className={input} value={r.weekday} onChange={e=>update(r.key,{weekday:Number(e.target.value)})}>{WEEKDAY_LABELS.map((d,i)=><option key={d} value={i+1}>{d}</option>)}</select>
   <input aria-label="Heure" type="time" required className={input} value={r.localTime} onChange={e=>update(r.key,{localTime:e.target.value.slice(0,5)})}/>
   <button type="button" onClick={()=>setRows(rows.filter(x=>x.key!==r.key))} className="rounded-lg border border-border px-2 py-1 text-xs">Supprimer</button></li>)}</ul>
   :<p className="text-sm text-muted">Aucun créneau</p>}
  <button type="button" disabled={rows.length>=MAX_SCHEDULE_SLOTS} onClick={()=>add()} className="text-sm text-accent disabled:text-muted">+ Ajouter un créneau</button>
  {restorable.length>0&&<div className="text-xs text-muted"><p>Anciens créneaux désactivés</p><ul className="mt-1 flex flex-wrap gap-2">{restorable.map(s=><li key={`${s.weekday}-${s.localTime}`}>
   <button type="button" onClick={()=>add(s)} className="rounded-full border border-border px-2 py-0.5">Réactiver {weekdayLabel(s.weekday)} {s.localTime}</button></li>)}</ul></div>}
  <p className="text-sm font-medium" data-posts-per-week="true">{postsPerWeekLabel(rows.length)}</p>
  {error&&<p role="alert" className="text-sm text-red-400">{error}</p>}
  <button disabled={pending||Boolean(error)} className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-background">{pending?'Enregistrement…':`Enregistrer ${card.label}`}</button>
  {state.message&&<p role="status" className={`text-sm ${state.ok?'':'text-red-400'}`}>{state.message}</p>}</form>;
}
