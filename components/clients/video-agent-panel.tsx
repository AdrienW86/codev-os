'use client';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useActionState,useState} from 'react';
import {saveVideoAgentAction,type VideoAgentState} from '@/app/(cockpit)/clients/[id]/video-actions';
import {MOTION_TRACKS,MUSIC_MOOD_LABELS} from '@/lib/motion/music';
import type {VideoAgentSettings} from '@/lib/video-agent/model';

type Item={id:string;created_at:string;service:string;headline:string;trigger:string};
const field='mt-1 block w-full rounded-lg border border-border bg-background p-2';
const day=(iso:string)=>new Date(iso).toLocaleDateString('fr-FR',{day:'numeric',month:'short',timeZone:'Europe/Paris'});

// Agent Vidéo : vidéos motion design générées à la fréquence choisie avec les photos publiables du client, rangées dans
// son Studio vidéo (rien n'est publié).
export function VideoAgentPanel({clientId,settings,items,services,photoCount}:{clientId:string;settings:VideoAgentSettings;items:Item[];services:string[];photoCount:number}){
 const router=useRouter();
 const [saved,save,saving]=useActionState(saveVideoAgentAction,{} as VideoAgentState);
 const [run,setRun]=useState<{pending:boolean;ok?:boolean;message?:string}>({pending:false});
 async function generate(){
  setRun({pending:true});
  try{const r=await fetch('/api/video-agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:clientId}),cache:'no-store'});
   const body=await r.json().catch(()=>null) as {ok?:boolean;message?:string}|null;
   setRun({pending:false,ok:Boolean(body?.ok),message:body?.message??'La vidéo n’a pas pu être créée.'});if(body?.ok)router.refresh();}
  catch{setRun({pending:false,ok:false,message:'Connexion interrompue : la vidéo n’a pas pu être créée.'});}
 }
 return <div className="space-y-5 text-sm">
  <p className="text-muted">Une courte vidéo verticale (photos publiables d’une même prestation, script contrôlé, musique de la bibliothèque, couleurs de l’Agent Visuels si réglées), rangée dans le <Link href={`/studio?client=${clientId}`} className="text-accent-hover underline">Studio vidéo</Link>. Rien n’est publié automatiquement.</p>
  {(!services.length||photoCount<2)&&<p role="alert" className="text-danger">{!services.length?'Aucune prestation confirmée : renseignez-les dans l’onglet Photothèque.':'Moins de 2 photos publiables : ajoutez des photos dans la photothèque.'}</p>}
  <form action={save} className="grid gap-4 md:grid-cols-2">
   <input type="hidden" name="client_id" value={clientId}/>
   <label className="flex items-center gap-2 md:col-span-2"><input type="checkbox" name="enabled" defaultChecked={settings.enabled}/><span className="font-medium">Activer l’Agent Vidéo pour ce client</span></label>
   <label className="block"><span className="font-medium">Vidéos par semaine</span><input type="number" name="per_week" min={1} max={7} defaultValue={settings.perWeek} className={field}/></label>
   <label className="block"><span className="font-medium">Rythme</span><select name="pace" defaultValue={settings.pace} className={field}><option value="dynamic">Dynamique</option><option value="standard">Standard</option><option value="calm">Posé</option></select></label>
   <label className="block md:col-span-2"><span className="font-medium">Musique de fond</span><select name="music" defaultValue={settings.music} className={field}>
    <option value="auto">Automatique (selon le rythme)</option><option value="none">Sans musique</option>
    {(['dynamic','standard','calm'] as const).map(mood=><optgroup key={mood} label={MUSIC_MOOD_LABELS[mood]}>{MOTION_TRACKS.filter(t=>t.mood===mood).map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</optgroup>)}
   </select></label>
   <div className="md:col-span-2"><button disabled={saving} className="rounded-lg bg-accent-strong px-3 py-1 font-semibold text-accent-foreground hover:bg-accent disabled:opacity-60">{saving?'Enregistrement…':'Enregistrer'}</button>
    {saved.message&&<span role={saved.ok?'status':'alert'} className={`ml-3 ${saved.ok?'':'text-danger'}`}>{saved.message}</span>}</div>
  </form>
  <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
   <button type="button" onClick={generate} disabled={run.pending||!services.length||photoCount<2} className="rounded-lg border border-border px-3 py-1 disabled:opacity-60">{run.pending?'Création de la vidéo… (jusqu’à 1 minute)':'Générer une vidéo maintenant'}</button>
   {run.message&&<span role={run.ok?'status':'alert'} className={run.ok?'':'text-danger'}>{run.message}</span>}
  </div>
  {items.length>0&&<div><h3 className="font-semibold">Dernières vidéos</h3><ul className="mt-2 space-y-1">{items.slice(0,6).map(i=>
   <li key={i.id} className="text-muted">{day(i.created_at)} · {i.service} · « {i.headline} »{i.trigger==='manual'?' (manuelle)':''}</li>)}</ul></div>}
 </div>;
}
