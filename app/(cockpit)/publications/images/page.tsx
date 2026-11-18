import Link from 'next/link';
import {requireAdmin} from '@/lib/require-admin';
import {listPendingImages} from '@/lib/publications/photo-agent/service';
import {GeneratedImageCard} from '@/components/publications/generated-image-card';
import {PageHeading} from '@/components/ui/primitives';
export const dynamic='force-dynamic';
export default async function GeneratedImagesPage(){
 await requireAdmin();const {available,items}=await listPendingImages();
 return <><PageHeading title="Images à valider" eyebrow="Agent Photo" description="Quand une préparation n’a aucune photo, l’Agent Photo propose une image d’illustration générée à partir du texte. Aucune image générée n’est attachée ni publiée sans ta validation."/>
 <Link href="/publications" className="text-accent">← Publications</Link>
 <div className="mt-6 space-y-6">
  {!available&&<p className="rounded-xl border border-border p-4 text-sm text-muted">Agent Photo non installé : la migration 20261214000000 n’est pas encore appliquée.</p>}
  {available&&!items.length&&<p className="rounded-xl border border-border p-4 text-sm text-muted">Aucune image en attente.</p>}
  {items.map(item=><GeneratedImageCard key={item.id} item={item}/>)}
 </div></>;
}
