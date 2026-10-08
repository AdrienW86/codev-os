// Agent v2 media step (Lot 4.3 P8): client-safe states, labels and messages. Pure.
// Semantics (documented by the tests): drafts are ALWAYS kept once created; a failed media step never rolls them back
// and is never reported as a full success: the run is explicitly needs_media and approval stays impossible.
export type AgentV2MediaFailure='media_unavailable'|'fetch_failed'|'invalid_media'|'upload_failed'|'attach_failed';
export type AgentV2MediaOutcome={state:'attached'}|{state:'needs_media';code:AgentV2MediaFailure}|{state:'in_progress'}|{state:'unconfirmed'};
// none: no media selected · attached · failed: drafts kept without media · pending: attempt running or interrupted.
export type AgentV2MediaState='none'|'attached'|'failed'|'pending';
export type AgentV2MediaView={state:AgentV2MediaState;category:string|null;preview:string|null};
// One completed preparation and its media, as displayed (category, state, short-lived signed preview only).
export type AgentV2MediaRunView={id:string;createdAt:string;drafts:number;media:AgentV2MediaView;retryable:boolean};

export const MEDIA_CATEGORY_LABELS:Record<string,string>={roof:'Toiture',pests:'Nuisibles',paint:'Peinture',facade:'Façade',digital:'Numérique'};
export const MEDIA_STATE_LABELS:Record<AgentV2MediaState,string>={none:'Aucun média',attached:'Média attaché',failed:'Échec média',pending:'Média en cours d’attachement'};
export function mediaCategoryLabel(scene:unknown):string|null{return typeof scene==='string'&&scene in MEDIA_CATEGORY_LABELS?MEDIA_CATEGORY_LABELS[scene]:null;}
export function mediaStateOf(outcome:AgentV2MediaOutcome|null):AgentV2MediaState{
 return !outcome?'none':outcome.state==='attached'?'attached':outcome.state==='in_progress'?'pending':'failed';
}
const drafts=(n:number)=>`${n} brouillon${n>1?'s':''} créé${n>1?'s':''}`;
export function agentV2ResultMessage(count:number,state:AgentV2MediaState):string{
 if(state==='attached')return `${drafts(count)} avec média. À relire et valider manuellement.`;
 if(state==='none')return `${drafts(count)} sans média. Média requis avant validation : ajoutez une photo à chaque brouillon.`;
 if(state==='pending')return `${drafts(count)} ; le média est en cours d’attachement. Média requis avant validation.`;
 return `${count>1?'Les brouillons ont été créés':'Le brouillon a été créé'} mais le média n’a pas pu être attaché. Média requis avant validation.`;
}
export function retryMessage(state:AgentV2MediaState):string{
 return state==='attached'?'Média attaché aux brouillons.':state==='pending'?'Un attachement est déjà en cours. Réessayez dans quelques minutes.'
  :'Le média n’a pas pu être attaché. Les brouillons restent sans média : média requis avant validation.';
}
