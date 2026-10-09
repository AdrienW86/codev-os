import {Panel} from '@/components/ui/primitives';
import {ReviewCard} from './review-card';
import type {ReviewCardData} from '@/lib/publications/review-cards';
// Single review UI shared by the project review tab and the global review queue.
export function ReviewQueue({cards,showContext=false}:{cards:ReviewCardData[];showContext?:boolean}){
 const pending=cards.filter(c=>c.status==='pending_review'),rejected=cards.filter(c=>c.status==='rejected');
 return <>
 <Panel className="mt-6 p-6"><h2 className="font-semibold">À valider <span className="text-sm font-normal text-muted">({pending.length})</span></h2>{pending.length?<div className="mt-4 space-y-5">{pending.map(c=><ReviewCard key={c.publicationId} card={c} showContext={showContext}/>)}</div>:<p className="mt-3 text-sm text-muted">Aucune publication en attente de validation.</p>}</Panel>
 <Panel className="mt-6 p-6"><h2 className="font-semibold">Rejetées <span className="text-sm font-normal text-muted">({rejected.length})</span></h2>{rejected.length?<div className="mt-4 space-y-5">{rejected.map(c=><ReviewCard key={c.publicationId} card={c} showContext={showContext}/>)}</div>:<p className="mt-3 text-sm text-muted">Aucune publication rejetée.</p>}</Panel></>;
}
