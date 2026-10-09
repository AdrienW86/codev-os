import Link from 'next/link';
import {requireAdmin} from '@/lib/require-admin';
import {listPublications} from '@/lib/publications/data';
import {buildReviewCards} from '@/lib/publications/review-cards';
import {isDebugView} from '@/lib/projects/workspace-view';
import {ReviewQueue} from '@/components/publications/review-queue';
import {PageHeading} from '@/components/ui/primitives';
export default async function PublicationsReviewPage({searchParams}:PageProps<'/publications/review'>){
 await requireAdmin();const cards=await buildReviewCards(await listPublications(),{debug:isDebugView(await searchParams)});
 return <><PageHeading title="Publications à valider" eyebrow="Validation humaine" description="Tous les clients et projets. Chaque décision concerne la version actuelle. Aucune diffusion externe."/><Link href="/publications" className="text-accent">← Publications</Link>
 <ReviewQueue cards={cards} showContext/></>;
}
