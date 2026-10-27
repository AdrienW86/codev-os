"use client";
import {useActionState} from "react";
import {rescheduleAction,suspendClientAction,suspendDeliveryAction,type SupervisionActionState} from "@/app/(cockpit)/publications/supervision-actions";
import {startOAuthAction,type ConnectionActionState} from "@/app/(cockpit)/publications/connection-actions";
import {formatSlot} from "@/lib/publications/supervision-model";

// Socle Publications, lot 7 : formulaires du tableau de supervision (une action explicite chacun, aucun envoi).
const button="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-border/40 disabled:opacity-50";
function Feedback({state}:{state:SupervisionActionState}){
 return state.message?<p role={state.ok?"status":"alert"} className={`mt-1 text-xs ${state.ok?"text-success":"text-danger"}`}>{state.message}</p>:null;
}
export function RescheduleForm({publicationId,revisionId,targets,approved}:{publicationId:string;revisionId:string;targets:{id:string;scheduledFor:string}[];approved:boolean}){
 const [state,action,pending]=useActionState(rescheduleAction,{} as SupervisionActionState);
 if(!targets.length)return <p className="text-xs text-muted">Aucun créneau libre sur 4 semaines.</p>;
 return <form action={action} className="flex flex-wrap items-center gap-1.5" data-reschedule-form="true">
  <input type="hidden" name="publication_id" value={publicationId}/><input type="hidden" name="revision_id" value={revisionId}/>
  <label className="sr-only" htmlFor={`slot-${publicationId}`}>Nouveau créneau</label>
  <select id={`slot-${publicationId}`} name="occurrence_id" required defaultValue="" className="rounded-md border border-border bg-surface px-2 py-1 text-xs">
   <option value="" disabled>Nouveau créneau…</option>
   {targets.map(t=><option key={t.id} value={t.id}>{formatSlot(t.scheduledFor)}</option>)}
  </select>
  <button disabled={pending} className={button} title={approved?"L’approbation sera à redonner pour le nouveau créneau.":undefined}>{pending?"Reprogrammation…":"Reprogrammer"}</button>
  <Feedback state={state}/>
 </form>;
}
export function SuspendDeliveryForm({publicationId}:{publicationId:string}){
 const [state,action,pending]=useActionState(suspendDeliveryAction,{} as SupervisionActionState);
 return <form action={action} data-suspend-delivery="true"><input type="hidden" name="publication_id" value={publicationId}/>
  <button disabled={pending} className={button}>{pending?"Suspension…":"Suspendre"}</button><Feedback state={state}/></form>;
}
export function SuspendClientForm({clientId,clientName}:{clientId:string;clientName:string}){
 const [state,action,pending]=useActionState(suspendClientAction,{} as SupervisionActionState);
 return <form action={action} data-suspend-client="true"><input type="hidden" name="client_id" value={clientId}/>
  <button disabled={pending} className={button} aria-label={`Suspendre la préparation automatique de ${clientName}`}>{pending?"Suspension…":"Suspendre la préparation"}</button><Feedback state={state}/></form>;
}
// Lot 7 (mobile) : « Reconnecter » relance le parcours OAuth EXISTANT (startOAuthAction : état à usage unique, page de
// consentement officielle, retour sur l'onglet Publications de la fiche client). Rien n'est publié.
export function ReconnectForm({projectId,provider,label}:{projectId:string;provider:"meta"|"google_business_profile"|"tiktok";label:string}){
 const [state,action,pending]=useActionState(startOAuthAction,{} as ConnectionActionState);
 return <form action={action} data-reconnect={provider}><input type="hidden" name="provider" value={provider}/><input type="hidden" name="project_id" value={projectId}/><input type="hidden" name="return_view" value="client"/>
  <button disabled={pending} className={button}>{pending?"Redirection…":`Reconnecter ${label}`}</button><Feedback state={state}/></form>;
}
