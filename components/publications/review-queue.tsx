import {Panel} from '@/components/ui/primitives';
import {ReviewCard,ReviewGroupHeader} from './review-card';
import {groupReviewCards} from '@/lib/publications/review-groups';
import type {ReviewCardData} from '@/lib/publications/review-cards';
// Single review UI shared by the project review tab and the global review queue. Validation simplifiée : les
// publications sœurs d'un même post (une par réseau) sont regroupées sous un en-tête avec « Tout approuver ».
function PendingGroups({cards,showContext}:{cards:ReviewCardData[];showContext:boolean}){
 return <div className="mt-4 space-y-5">{groupReviewCards(cards).map(g=>g.cards.length>1
  ?<section key={g.key} data-review-group="true" className="space-y-3 rounded-2xl border border-border p-4"><ReviewGroupHeader cards={g.cards} showContext={showContext}/>{g.cards.map(c=><ReviewCard key={c.publicationId} card={c} showContext={showContext}/>)}</section>
  :<ReviewCard key={g.key} card={g.cards[0]} showContext={showContext}/>)}</div>;
}
export function ReviewQueue({cards,showContext=false}:{cards:ReviewCardData[];showContext?:boolean}){
 const pending=cards.filter(c=>c.status==='pending_review'),rejected=cards.filter(c=>c.status==='rejected');
 return <>
 <Panel className="mt-6 p-6"><h2 className="font-semibold">À valider <span className="text-sm font-normal text-muted">({pending.length})</span></h2>{pending.length?<PendingGroups cards={pending} showContext={showContext}/>:<p className="mt-3 text-sm text-muted">Aucune publication en attente de validation.</p>}</Panel>
 <Panel className="mt-6 p-6"><h2 className="font-semibold">Rejetées <span className="text-sm font-normal text-muted">({rejected.length})</span></h2>{rejected.length?<div className="mt-4 space-y-5">{rejected.map(c=><ReviewCard key={c.publicationId} card={c} showContext={showContext}/>)}</div>:<p className="mt-3 text-sm text-muted">Aucune publication rejetée.</p>}</Panel></>;
}
