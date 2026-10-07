// Pure presentation helpers for the project workspace tabs. No data access, safe for tests.
import type {CalendarStatus} from '@/lib/publications/calendar';

export type ProjectTabKey='overview'|'calendar'|'agent'|'review'|'configuration'|'history';
export type ProjectTab={key:ProjectTabKey;label:string;href:string;segment:string|null};

const tabs:{key:ProjectTabKey;label:string;segment:string|null;publications:boolean}[]=[
 {key:'overview',label:'Vue d’ensemble',segment:null,publications:false},
 {key:'calendar',label:'Calendrier',segment:'calendar',publications:true},
 {key:'agent',label:'Agent Publications',segment:'agent',publications:true},
 {key:'review',label:'Validation',segment:'review',publications:true},
 {key:'configuration',label:'Configuration',segment:'configuration',publications:true},
 {key:'history',label:'Historique',segment:'history',publications:false},
];
// Publication tabs only exist for project types that actually have publication platforms.
export function projectTabs(projectId:string,hasPublications:boolean):ProjectTab[]{
 return tabs.filter(t=>hasPublications||!t.publications).map(t=>({key:t.key,label:t.label,segment:t.segment,href:t.segment?`/projects/${projectId}/${t.segment}`:`/projects/${projectId}`}));
}

export const publicationStatusLabels={draft:'Brouillon',pending_review:'À valider',approved:'Validé',rejected:'Rejeté'} as const;
export function publicationStatusLabel(status:string):string{return (publicationStatusLabels as Record<string,string>)[status]??'Statut inconnu';}

export type SlotDisplay='empty'|'draft'|'pending_review'|'approved'|'rejected'|'published'|'scheduled'|'error';
export const slotDisplayLabels:Record<SlotDisplay,string>={empty:'Vide',draft:'Brouillon',pending_review:'À valider',approved:'Validé',rejected:'Rejeté',published:'Publié',scheduled:'Planifié',error:'Erreur'};
export const slotDisplayClasses:Record<SlotDisplay,string>={
 empty:'border-dashed border-border text-muted',draft:'border-border bg-background',pending_review:'border-amber-500 bg-amber-500/10',
 approved:'border-emerald-600 bg-emerald-600/10',rejected:'border-red-600 bg-red-600/10',published:'border-sky-600 bg-sky-600/10',
 scheduled:'border-sky-400 bg-sky-400/10',error:'border-red-700 bg-red-700/15'};
// A reserved placeholder without any revision is shown as empty, like an unreserved slot.
export function slotDisplay(entry:{status:CalendarStatus;revision:number|null}):SlotDisplay{
 if(entry.status==='free'||entry.status==='draft'&&entry.revision===null)return 'empty';
 return entry.status;
}

export function isDebugView(search:Record<string,string|string[]|undefined>):boolean{return search.debug==='1';}

export type AgentStatus='active'|'inactive'|'unconfigured'|'unavailable';
export const agentStatusLabels:Record<AgentStatus,string>={active:'Actif',inactive:'Configuré, désactivé',unconfigured:'Non configuré',unavailable:'Indisponible'};
export function agentStatus(state:{ready:boolean;config:{enabled:boolean}|null}|null):AgentStatus{
 if(!state||!state.ready)return 'unavailable';if(!state.config)return 'unconfigured';return state.config.enabled?'active':'inactive';
}

// Only alerts backed by real data and requiring an admin decision.
export function projectAlerts(input:{today:string;agent:AgentStatus;cadenceEnabled:boolean|null;upcoming:{date:string;display:SlotDisplay}[];pending:{target_date:string|null}[];calendarUnavailable:boolean}):string[]{
 const alerts:string[]=[];
 if(input.calendarUnavailable)alerts.push('Calendrier indisponible : vérifiez l’accès au stockage.');
 const late=input.pending.filter(p=>p.target_date!==null&&p.target_date<input.today).length;
 if(late)alerts.push(`${late} publication(s) à valider dont la date est dépassée.`);
 if(input.agent==='unconfigured')alerts.push('Agent Publications non configuré pour ce projet.');
 if(input.cadenceEnabled===false)alerts.push('Cadence de publication inactive.');
 const soon=input.upcoming.filter(e=>e.date>=input.today&&e.date<=addDaysIso(input.today,7));
 if(input.cadenceEnabled&&!soon.length&&!input.calendarUnavailable)alerts.push('Aucun créneau prévu dans les 7 prochains jours.');
 const emptySoon=soon.filter(e=>e.display==='empty').length;
 if(emptySoon)alerts.push(`${emptySoon} créneau(x) sans contenu dans les 7 prochains jours.`);
 return alerts;
}
function addDaysIso(date:string,days:number){return new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);}

export function formatDay(date:string):string{
 const d=new Date(date+'T00:00:00Z');if(Number.isNaN(d.getTime()))return date;
 return new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'}).format(d);
}
