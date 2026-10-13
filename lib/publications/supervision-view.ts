// Socle Publications, lot 7 (mobile) : navigation de la supervision sur une seule page. Pur et testable : lecture des
// paramètres d'URL (lien profond utilisable par l'assistant), liens des onglets et filtre par client.
//
// Paramètres de /publications/supervision :
//   view   = overview (défaut) | review | errors | scheduled | accounts | photos | agent
//   client = identifiant (uuid) d'un client présent dans la supervision ; inconnu ou invalide → ignoré (tous les clients)
// Exemple : /publications/supervision?view=review&client=<id> ouvre les publications à valider de ce client.
import {isPublicationUuid} from './validation';

export const SUPERVISION_VIEWS=['overview','review','errors','scheduled','accounts','photos','agent'] as const;
export type SupervisionView=(typeof SUPERVISION_VIEWS)[number];
export const SUPERVISION_VIEW_LABELS:Record<SupervisionView,string>={overview:'Synthèse',review:'À valider',errors:'Erreurs',scheduled:'Programmées',accounts:'Comptes',photos:'Photos',agent:'Agent'};
export const SUPERVISION_PATH='/publications/supervision';

type Search=Record<string,string|string[]|undefined>;
const one=(value:string|string[]|undefined)=>Array.isArray(value)?value[0]:value;
/** Vue et client demandés ; tout ce qui n'est pas reconnu retombe sur la synthèse et tous les clients. */
export function parseSupervisionQuery(search:Search,clientIds:readonly string[]):{view:SupervisionView;client:string|null}{
 const view=one(search.view),client=one(search.client);
 return {view:(SUPERVISION_VIEWS as readonly string[]).includes(view??'')?view as SupervisionView:'overview',
  client:isPublicationUuid(client)&&clientIds.includes(client)?client:null};
}
/** Lien d'une vue, en conservant le client filtré. La synthèse n'a pas de paramètre view. */
export function supervisionHref(view:SupervisionView,client:string|null=null):string{
 const params=new URLSearchParams();
 if(view!=='overview')params.set('view',view);
 if(client)params.set('client',client);
 const query=params.toString();
 return query?`${SUPERVISION_PATH}?${query}`:SUPERVISION_PATH;
}

/** Filtre par client d'une supervision déjà lue (aucune nouvelle lecture) ; les compteurs suivent le filtre. « À valider »
 * compte la file de validation complète (publications programmées ou non), comme la page /publications/review. */
type Filterable={clientId:string};
export type FilterableSupervision<P extends Filterable,C extends {id:string;accounts:{state:string}[]},T extends Filterable>={
 clients:C[];scheduled:P[];errors:P[];published:P[];tasks:T[];
 counts:{pendingReview:number;scheduled:number;published:number;errors:number;connected:number;reconnect:number}};
export function filterSupervision<P extends Filterable&{status:string},C extends {id:string;accounts:{state:string}[]},T extends Filterable,S extends FilterableSupervision<P,C,T>>(data:S,client:string|null,pendingReview:readonly Filterable[]):S{
 if(!client)return {...data,counts:{...data.counts,pendingReview:pendingReview.length}};
 const keep=<X extends Filterable>(list:X[])=>list.filter(x=>x.clientId===client);
 const clients=data.clients.filter(c=>c.id===client),accounts=clients.flatMap(c=>c.accounts);
 const scheduled=keep(data.scheduled),errors=keep(data.errors),published=keep(data.published);
 return {...data,clients,scheduled,errors,published,tasks:keep(data.tasks),
  counts:{pendingReview:pendingReview.filter(p=>p.clientId===client).length,scheduled:scheduled.length,published:published.length,errors:errors.length,
   connected:accounts.filter(a=>a.state==='connected').length,reconnect:accounts.filter(a=>a.state==='reconnect').length}};
}

/** Pastille de chaque onglet : ce qui demande une action (à valider, erreurs, à reconnecter, clients à court de photos). */
export function supervisionBadges(data:{counts:{pendingReview:number;scheduled:number;errors:number;reconnect:number};clients:{tooFewPhotos:boolean}[];tasks:unknown[]}):Record<SupervisionView,number|null>{
 return {overview:null,review:data.counts.pendingReview,errors:data.counts.errors,scheduled:data.counts.scheduled,accounts:data.counts.reconnect,
  photos:data.clients.filter(c=>c.tooFewPhotos).length,agent:data.tasks.length};
}
