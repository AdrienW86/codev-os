'use client';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useActionState,useState} from 'react';
import {saveBlogAgentAction,type BlogAgentState} from '@/app/(cockpit)/clients/[id]/blog-actions';
import type {BlogAgentSettings} from '@/lib/blog-agent/model';

type Article={id:string;title:string;status:'scheduled'|'published'|'cancelled';publish_at:string;published_at:string|null;social_status:string};
const field='mt-1 block w-full rounded-lg border border-border bg-background p-2';
const when=(iso:string)=>new Date(iso).toLocaleString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'});
const STATUS={scheduled:'Programmé',published:'Publié',cancelled:'Annulé'} as const;

// Agent Blog : un ou deux articles par semaine sur le site du client, annoncés 24 h avant par une notification,
// puis publiés automatiquement (et résumés sur les réseaux si le relais est activé).
export function BlogAgentPanel({clientId,settings,defaultSite,articles,services,photoCount,apiBase}:{clientId:string;settings:BlogAgentSettings;defaultSite:string|null;
 articles:Article[];services:string[];photoCount:number;apiBase:string}){
 const router=useRouter();
 const [saved,save,saving]=useActionState(saveBlogAgentAction,{} as BlogAgentState);
 const [run,setRun]=useState<{pending:boolean;ok?:boolean;message?:string;id?:string}>({pending:false});
 async function generate(){
  setRun({pending:true});
  try{const r=await fetch('/api/blog-agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:clientId}),cache:'no-store'});
   const body=await r.json().catch(()=>null) as {ok?:boolean;message?:string;id?:string}|null;
   setRun({pending:false,ok:Boolean(body?.ok),message:body?.message??'L’article n’a pas pu être rédigé.',id:body?.id});if(body?.ok)router.refresh();}
  catch{setRun({pending:false,ok:false,message:'Connexion interrompue : l’article n’a peut-être pas été rédigé. Rechargez la page avant de réessayer.'});}
 }
 const ready=Boolean(settings.siteUrl)&&services.length>0&&photoCount>0;
 return <div className="space-y-5 text-sm">
  <p className="text-muted">Un article illustré par une photo de la photothèque, rédigé à partir des prestations confirmées (aucun prix, garantie ni label inventé). Il est annoncé par une notification <strong>24 h avant</strong> sa mise en ligne : vous pouvez le relire, le modifier ou l’annuler. Le site du client l’affiche sur sa page blog.</p>
  {!services.length&&<p role="alert" className="text-danger">Aucune prestation confirmée : renseignez-les dans l’onglet Photothèque.</p>}
  {services.length>0&&!photoCount&&<p role="alert" className="text-danger">Aucune photo publiable : ajoutez des photos dans la photothèque.</p>}
  <form action={save} className="grid gap-4 md:grid-cols-2">
   <input type="hidden" name="client_id" value={clientId}/>
   <label className="flex items-center gap-2 md:col-span-2"><input type="checkbox" name="enabled" defaultChecked={settings.enabled}/><span className="font-medium">Activer l’Agent Blog pour ce client</span></label>
   <label className="block"><span className="font-medium">Articles par semaine</span><select name="per_week" defaultValue={String(settings.perWeek)} className={field}><option value="1">1 par semaine</option><option value="2">2 par semaine</option></select></label>
   <label className="block"><span className="font-medium">Site du client</span><input name="site_url" type="url" inputMode="url" placeholder="https://www.exemple.fr" defaultValue={settings.siteUrl??defaultSite??''} className={field}/></label>
   <label className="block"><span className="font-medium">Chemin du blog</span><input name="blog_path" defaultValue={settings.blogPath} className={field}/></label>
   <label className="flex items-start gap-2 md:col-span-2"><input type="checkbox" name="social_relay" defaultChecked={settings.socialRelay} className="mt-1"/><span><span className="font-medium">Relayer chaque article sur les réseaux, sans validation</span><br/><span className="text-muted">À la mise en ligne, un résumé part sur Facebook, Instagram et Google (réseaux actifs du client) avec « Retrouvez l’intégralité de notre article sur notre site web » et le lien. Validé en votre nom.</span></span></label>
   <div className="md:col-span-2"><button disabled={saving} className="rounded-lg bg-accent-strong px-3 py-1 font-semibold text-accent-foreground hover:bg-accent disabled:opacity-60">{saving?'Enregistrement…':'Enregistrer'}</button>
    {saved.message&&<span role={saved.ok?'status':'alert'} className={`ml-3 ${saved.ok?'':'text-danger'}`}>{saved.message}</span>}</div>
  </form>
  <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
   <button type="button" onClick={generate} disabled={run.pending||!ready} className="rounded-lg border border-border px-3 py-1 disabled:opacity-60">{run.pending?'Rédaction de l’article… (jusqu’à 2 minutes)':'Rédiger un article maintenant'}</button>
   {run.message&&<span role={run.ok?'status':'alert'} className={run.ok?'':'text-danger'}>{run.message} {run.id&&<Link href={`/blog/${run.id}`} className="text-accent-hover underline">Relire</Link>}</span>}
  </div>
  {articles.length>0&&<div><h3 className="font-semibold">Articles</h3><ul className="mt-2 divide-y divide-border">{articles.slice(0,8).map(a=>
   <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2"><Link href={`/blog/${a.id}`} className="font-medium hover:text-accent-hover hover:underline">{a.title}</Link>
    <span className="text-xs text-muted">{STATUS[a.status]} · {when(a.status==='published'&&a.published_at?a.published_at:a.publish_at)}</span></li>)}</ul></div>}
  <details className="text-xs text-muted"><summary className="cursor-pointer">Intégration sur le site (développeur)</summary>
   <p className="mt-2">Liste : <code className="break-all">{apiBase}/api/public/blog/{clientId}</code></p>
   <p>Article : <code className="break-all">{apiBase}/api/public/blog/{clientId}/&lt;slug&gt;</code></p></details>
 </div>;
}
