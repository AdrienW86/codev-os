'use client';
import {useActionState} from 'react';
import {runVisualAction,saveVisualAgentAction,type VisualAgentState} from '@/app/(cockpit)/clients/[id]/visual-actions';
import type {VisualAgentSettings} from '@/lib/visual-agent/model';

type Item={service:string;headline:string;template:string;created_at:string;trigger:string};
const field='mt-1 block w-full rounded-lg border border-border bg-background p-2';
const day=(iso:string)=>new Date(iso).toLocaleDateString('fr-FR',{day:'numeric',month:'short',timeZone:'Europe/Paris'});

// Agent Visuels : visuels à la charte du client, générés à la fréquence choisie et déposés dans sa photothèque Drive.
export function VisualAgentPanel({clientId,settings,items,services,folderReady,logoPreview}:{clientId:string;settings:VisualAgentSettings;items:Item[];services:string[];folderReady:boolean;logoPreview:string|null}){
 const [saved,save,saving]=useActionState(saveVisualAgentAction,{} as VisualAgentState);
 const [run,launch,running]=useActionState(runVisualAction,{} as VisualAgentState);
 const defaults=settings.primaryColor==='#1f2937'&&settings.secondaryColor==='#f59e0b';
 return <div className="space-y-6 text-sm">
  <p className="text-muted">Visuels à la charte (logo, couleurs, prestation et accroche contrôlée), au format 1080 × 1350, déposés dans le dossier Drive de la photothèque. Ils sont importés et analysés comme les photos, puis l’agent Publications les choisit quand le sujet s’y prête.</p>
  {!folderReady&&<p role="alert" className="text-danger">Aucun dossier Drive de photothèque n’est configuré pour ce client : les visuels ne pourront pas être déposés (l’aperçu reste possible).</p>}
  {!services.length&&<p role="alert" className="text-danger">Aucune prestation confirmée : renseignez-les dans l’onglet Photothèque.</p>}
  <form action={save} className="grid gap-4 md:grid-cols-2">
   <input type="hidden" name="client_id" value={clientId}/>
   <label className="flex items-center gap-2 md:col-span-2"><input type="checkbox" name="enabled" defaultChecked={settings.enabled}/><span className="font-medium">Activer l’Agent Visuels pour ce client</span></label>
   <label className="block"><span className="font-medium">Visuels par semaine</span><input type="number" name="per_week" min={1} max={14} defaultValue={settings.perWeek} className={field}/></label>
   <label className="block"><span className="font-medium">Ligne de contact (site ou téléphone)</span><input name="contact_line" maxLength={80} defaultValue={settings.contactLine??''} placeholder="ex. code-v.fr" className={field}/></label>
   <label className="block md:col-span-2"><span className="font-medium">Logo (PNG transparent de préférence)</span>
    {logoPreview&&<img src={logoPreview} alt="Logo actuel" className="my-2 max-h-20 rounded bg-white p-2"/>}
    <input type="file" name="logo" accept="image/png,image/jpeg,image/webp" className={field}/></label>
   <label className="flex items-center gap-2 md:col-span-2"><input type="checkbox" name="colors_from_logo" defaultChecked={defaults}/>Proposer les couleurs à partir du nouveau logo</label>
   <div className="grid grid-cols-3 gap-3 md:col-span-2">
    {([['primary_color','Couleur principale',settings.primaryColor],['secondary_color','Couleur d’accent',settings.secondaryColor],['text_color','Texte sur la couleur principale',settings.textColor]] as const).map(([name,label,value])=>
     <label key={name} className="block"><span className="font-medium">{label}</span><input type="color" name={name} defaultValue={value} className="mt-1 block h-10 w-full rounded-lg border border-border"/></label>)}
   </div>
   <div className="md:col-span-2"><button disabled={saving} className="rounded-lg bg-accent-strong px-3 py-1 font-semibold text-accent-foreground hover:bg-accent disabled:opacity-60">{saving?'Enregistrement…':'Enregistrer'}</button>
    {saved.message&&<span role={saved.ok?'status':'alert'} className={`ml-3 ${saved.ok?'':'text-danger'}`}>{saved.message}</span>}</div>
  </form>
  <form action={launch} className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
   <input type="hidden" name="client_id" value={clientId}/>
   <button name="mode" value="preview" disabled={running||!services.length} className="rounded-lg border border-border px-3 py-1 disabled:opacity-60">{running?'Génération…':'Générer un aperçu'}</button>
   <button name="mode" value="generate" disabled={running||!services.length||!folderReady} className="rounded-lg border border-border px-3 py-1 disabled:opacity-60">Générer et déposer maintenant</button>
   {run.message&&<span role={run.ok?'status':'alert'} className={run.ok?'':'text-danger'}>{run.message}</span>}
  </form>
  {run.preview&&<img src={run.preview} alt={run.headline??'Aperçu du visuel'} className="w-full max-w-sm rounded-lg border border-border"/>}
  {items.length>0&&<div><h3 className="font-semibold">Derniers visuels</h3><ul className="mt-2 space-y-1">{items.slice(0,8).map(i=>
   <li key={i.created_at} className="text-muted">{day(i.created_at)} · {i.service} · « {i.headline} »{i.trigger==='manual'?' (manuel)':''}</li>)}</ul></div>}
 </div>;
}
