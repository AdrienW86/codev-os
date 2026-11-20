import Link from 'next/link';
import {requireAdmin} from '@/lib/require-admin';
import {listPublications} from '@/lib/publications/data';
import {buildReviewCards} from '@/lib/publications/review-cards';
import {isDebugView} from '@/lib/projects/workspace-view';
import {ReviewQueue} from '@/components/publications/review-queue';
import {PageHeading} from '@/components/ui/primitives';
import {MonthlyBatchPanel} from '@/components/publications/monthly-batch-panel';
import {monthlyReview} from '@/lib/publications/monthly-review';
// « Tout valider » enchaîne jusqu'à 60 validations.
export const maxDuration=120;
export default async function PublicationsReviewPage({searchParams}:PageProps<'/publications/review'>){
 await requireAdmin();const review=await monthlyReview().catch(()=>null);const cards=await buildReviewCards(await listPublications(undefined,undefined,{statuses:["pending_review","rejected"],activeOnly:true}),{debug:isDebugView(await searchParams)});
 return <><PageHeading title="Publications à valider" eyebrow="Validation humaine" description="Tous les clients et projets. Chaque décision concerne la version actuelle. Aucune diffusion externe."/><Link href="/publications" className="text-accent">← Publications</Link>
 {review&&<MonthlyBatchPanel review={review}/>}
 <ReviewQueue cards={cards} showContext/></>;
}
