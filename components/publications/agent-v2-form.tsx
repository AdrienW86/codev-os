'use client';
import Link from 'next/link';
import {useActionState} from 'react';
import {prepareNextPublicationsAction,type AgentV2State} from '@/app/(cockpit)/publications/agent-v2-actions';

// Agent Publications v2 trigger: explicit AI authorization, drafts only, links to the created publications.
export function AgentV2Form({projectId,disabled}:{projectId:string;disabled:boolean}){
 const [state,prepare,pending]=useActionState(prepareNextPublicationsAction,{} as AgentV2State);
 return <form action={prepare} className="mt-4 space-y-3 text-sm"><input type="hidden" name="project_id" value={projectId}/>
  <label className="block"><input type="checkbox" name="authorize_ai" required disabled={disabled}/> J’autorise un appel IA réel pour préparer ces brouillons (aucune publication n’est diffusée).</label>
  <button disabled={disabled||pending} className="rounded-lg bg-accent px-4 py-2 font-semibold text-background disabled:opacity-50">{pending?'Préparation…':'Préparer les prochaines publications'}</button>
  {state.message&&<p role={state.ok?'status':'alert'} className={state.ok?'':'text-red-400'}>{state.message}</p>}
  {state.ok&&state.publications&&state.publications.length>0&&<ul className="space-y-1" data-agent-v2-created="true">{state.publications.map(p=><li key={p.id}><Link className="text-accent" href={`/publications?publication=${p.id}`}>{p.label} · brouillon à relire</Link></li>)}</ul>}</form>;
}
